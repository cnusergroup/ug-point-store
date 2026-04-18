import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

export interface FrontendStackProps extends cdk.StackProps {
  /** The full REST API URL from ApiStack, e.g. https://xxx.execute-api.region.amazonaws.com/prod/ */
  apiUrl: string;
  /** HMAC secret used to sign and verify upload tokens */
  uploadTokenSecret: string;
  /** ARN of the pre-deployed Lambda@Edge function version in us-east-1 (optional, skip edge lambda if empty) */
  edgeSignerLambdaArn?: string;
  /** Custom domain name for CloudFront */
  domainName: string;
  /** ACM certificate ARN for the custom domain (must be in us-east-1) */
  certificateArn: string;
}

export class FrontendStack extends cdk.Stack {
  public readonly staticBucket: s3.Bucket;
  public readonly imagesBucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: FrontendStackProps) {
    super(scope, id, props);

    // --- S3 Buckets ---

    this.staticBucket = new s3.Bucket(this, 'StaticAssetsBucket', {
      bucketName: cdk.PhysicalName.GENERATE_IF_NEEDED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    this.imagesBucket = new s3.Bucket(this, 'ProductImagesBucket', {
      bucketName: cdk.PhysicalName.GENERATE_IF_NEEDED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
        },
      ],
      lifecycleRules: [
        {
          id: 'cleanup-temp-uploads',
          prefix: 'products/temp/',
          expiration: cdk.Duration.days(1),
        },
        {
          id: 'cleanup-report-exports',
          prefix: 'exports/',
          expiration: cdk.Duration.days(1),
        },
        {
          id: 'cleanup-content-temp-uploads',
          prefix: 'content/temp/',
          expiration: cdk.Duration.days(1),
        },
      ],
    });

    // --- CloudFront Distribution ---

    const hasEdgeSigner = !!props.edgeSignerLambdaArn;
    const apiUrlObj = this.parseApiUrl(props.apiUrl);
    const staticOrigin = origins.S3BucketOrigin.withOriginAccessControl(this.staticBucket);
    const imagesOrigin = origins.S3BucketOrigin.withOriginAccessControl(this.imagesBucket);
    // For upload paths with Lambda@Edge: use S3 REST API origin (no OAC)
    // Lambda@Edge handles SigV4 signing; OAC would conflict with it
    const imagesUploadOrigin = hasEdgeSigner
      ? new origins.HttpOrigin(this.imagesBucket.bucketRegionalDomainName, {
          protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
        })
      : imagesOrigin;
    const apiOrigin = new origins.HttpOrigin(apiUrlObj.domainName, {
      originPath: `/${apiUrlObj.stageName}`,
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
    });

    // Build upload behavior config

    let uploadBehaviorExtras: Partial<cloudfront.BehaviorOptions> = {};
    if (hasEdgeSigner) {
      const edgeSignerVersion = lambda.Version.fromVersionArn(
        this, 'EdgeSignerVersion', props.edgeSignerLambdaArn!,
      );

      const uploadOriginRequestPolicy = new cloudfront.OriginRequestPolicy(this, 'UploadOriginRequestPolicy', {
        headerBehavior: cloudfront.OriginRequestHeaderBehavior.allowList('Content-Type', 'Content-Length'),
        queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.all(),
      });

      const uploadResponseHeadersPolicy = new cloudfront.ResponseHeadersPolicy(this, 'UploadCorsPolicy', {
        corsBehavior: {
          accessControlAllowOrigins: [`https://${props.domainName}`],
          accessControlAllowMethods: ['GET', 'PUT', 'OPTIONS'],
          accessControlAllowHeaders: ['Content-Type', 'Content-Length'],
          accessControlAllowCredentials: false,
          originOverride: true,
        },
      });

      uploadBehaviorExtras = {
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: uploadOriginRequestPolicy,
        responseHeadersPolicy: uploadResponseHeadersPolicy,
        edgeLambdas: [{
          functionVersion: edgeSignerVersion,
          eventType: cloudfront.LambdaEdgeEventType.ORIGIN_REQUEST,
          includeBody: false,
        }],
      };
    }

    const uploadBehavior: cloudfront.BehaviorOptions = {
      origin: hasEdgeSigner ? imagesUploadOrigin : imagesOrigin,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      ...(hasEdgeSigner ? uploadBehaviorExtras : {
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      }),
    };

    // CloudFront Function: write cf_country cookie from Viewer-Country header
    const countryCookieFn = new cloudfront.Function(this, 'CountryCookieFunction', {
      code: cloudfront.FunctionCode.fromFile({
        filePath: path.join(__dirname, '../lambda/cf-country-cookie/index.js'),
      }),
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      comment: 'Sets cf_country cookie from CloudFront-Viewer-Country header',
    });

    const domainName = props.domainName;
    const certificateArn = props.certificateArn;

    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: 'Points Mall CDN',
      defaultRootObject: 'index.html',
      domainNames: [domainName],
      certificate: acm.Certificate.fromCertificateArn(this, 'CustomCert', certificateArn),
      defaultBehavior: {
        origin: staticOrigin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        functionAssociations: [{
          function: countryCookieFn,
          eventType: cloudfront.FunctionEventType.VIEWER_RESPONSE,
        }],
      },
      additionalBehaviors: {
        '/api/*': {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
        '/products/*': uploadBehavior,
        '/claims/*': uploadBehavior,
        '/content/*': uploadBehavior,
      },
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html', ttl: cdk.Duration.seconds(0) },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html', ttl: cdk.Duration.seconds(0) },
      ],
    });

    // --- Outputs ---
    new cdk.CfnOutput(this, 'DistributionDomainName', { value: this.distribution.distributionDomainName, exportName: 'PointsMall-DistributionDomain' });
    new cdk.CfnOutput(this, 'DistributionId', { value: this.distribution.distributionId, exportName: 'PointsMall-DistributionId' });
    new cdk.CfnOutput(this, 'StaticBucketName', { value: this.staticBucket.bucketName, exportName: 'PointsMall-StaticBucketName' });
    new cdk.CfnOutput(this, 'ImagesBucketName', { value: this.imagesBucket.bucketName, exportName: 'PointsMall-ImagesBucketName' });
    new cdk.CfnOutput(this, 'ImagesBucketArn', { value: this.imagesBucket.bucketArn, exportName: 'PointsMall-ImagesBucketArn' });

    // --- L1 escape hatch: add a no-OAC origin for upload paths ---
    // OAC signs requests AFTER Lambda@Edge, overriding our SigV4 signature.
    // We need a separate origin without OAC for PUT requests.
    if (hasEdgeSigner) {
      const cfnDist = this.distribution.node.defaultChild as cloudfront.CfnDistribution;
      const uploadOriginId = 'S3UploadOriginNoOAC';

      // Find the existing images origin to get its index
      // CDK generates origins array — we need to append a new one
      // Use addPropertyOverride on the raw CloudFormation template
      cfnDist.addPropertyOverride(`DistributionConfig.Origins.${4}`, {
        Id: uploadOriginId,
        DomainName: this.imagesBucket.bucketRegionalDomainName,
        S3OriginConfig: {
          OriginAccessIdentity: '',
        },
        // Intentionally NO OriginAccessControlId
      });

      // Override upload behavior target origins to use the no-OAC origin
      // CacheBehaviors order: /api/*, /products/*, /claims/*, /content/*
      cfnDist.addPropertyOverride('DistributionConfig.CacheBehaviors.1.TargetOriginId', uploadOriginId);
      cfnDist.addPropertyOverride('DistributionConfig.CacheBehaviors.2.TargetOriginId', uploadOriginId);
      cfnDist.addPropertyOverride('DistributionConfig.CacheBehaviors.3.TargetOriginId', uploadOriginId);
    }
  }

  private parseApiUrl(apiUrl: string): { domainName: string; stageName: string } {
    const withoutProtocol = apiUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const slashIndex = withoutProtocol.indexOf('/');
    if (slashIndex === -1) return { domainName: withoutProtocol, stageName: '' };
    return { domainName: withoutProtocol.substring(0, slashIndex), stageName: withoutProtocol.substring(slashIndex + 1) };
  }
}
