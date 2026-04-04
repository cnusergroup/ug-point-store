import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import { Construct } from 'constructs';

export interface FrontendStackProps extends cdk.StackProps {
  /** The full REST API URL from ApiStack, e.g. https://xxx.execute-api.region.amazonaws.com/prod/ */
  apiUrl: string;
}

export class FrontendStack extends cdk.Stack {
  public readonly staticBucket: s3.Bucket;
  public readonly imagesBucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: FrontendStackProps) {
    super(scope, id, props);

    // --- S3 Buckets ---

    // Static assets bucket (frontend build output)
    this.staticBucket = new s3.Bucket(this, 'StaticAssetsBucket', {
      bucketName: cdk.PhysicalName.GENERATE_IF_NEEDED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    // Product images bucket
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
    });

    // --- CloudFront Distribution ---

    // Parse API Gateway domain and stage from the URL
    // apiUrl format: https://<api-id>.execute-api.<region>.amazonaws.com/<stage>/
    const apiUrlObj = this.parseApiUrl(props.apiUrl);

    // S3 Origin Access Control (OAC) is handled automatically by S3BucketOrigin.withOriginAccessControl
    const staticOrigin = origins.S3BucketOrigin.withOriginAccessControl(this.staticBucket);
    const imagesOrigin = origins.S3BucketOrigin.withOriginAccessControl(this.imagesBucket);

    // API Gateway origin
    const apiOrigin = new origins.HttpOrigin(apiUrlObj.domainName, {
      originPath: `/${apiUrlObj.stageName}`,
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
    });

    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: 'Points Mall CDN',
      defaultRootObject: 'index.html',

      // Default behavior: static assets from S3
      defaultBehavior: {
        origin: staticOrigin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },

      additionalBehaviors: {
        // API requests → API Gateway
        '/api/*': {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
        // Product images → images S3 bucket (new format: /products/...)
        '/products/*': {
          origin: imagesOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        },
        // Claim images → images S3 bucket (new format: /claims/...)
        '/claims/*': {
          origin: imagesOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        },
      },

      // SPA fallback: return index.html for 403/404 so client-side routing works
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
      ],
    });

    // --- Outputs ---

    new cdk.CfnOutput(this, 'DistributionDomainName', {
      value: this.distribution.distributionDomainName,
      exportName: 'PointsMall-DistributionDomain',
    });

    new cdk.CfnOutput(this, 'DistributionId', {
      value: this.distribution.distributionId,
      exportName: 'PointsMall-DistributionId',
    });

    new cdk.CfnOutput(this, 'StaticBucketName', {
      value: this.staticBucket.bucketName,
      exportName: 'PointsMall-StaticBucketName',
    });

    new cdk.CfnOutput(this, 'ImagesBucketName', {
      value: this.imagesBucket.bucketName,
      exportName: 'PointsMall-ImagesBucketName',
    });

    new cdk.CfnOutput(this, 'ImagesBucketArn', {
      value: this.imagesBucket.bucketArn,
      exportName: 'PointsMall-ImagesBucketArn',
    });
  }

  /**
   * Parse an API Gateway URL into domain name and stage name.
   * Expected format: https://<api-id>.execute-api.<region>.amazonaws.com/<stage>/
   */
  private parseApiUrl(apiUrl: string): { domainName: string; stageName: string } {
    // Remove trailing slash and protocol
    const withoutProtocol = apiUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const slashIndex = withoutProtocol.indexOf('/');

    if (slashIndex === -1) {
      return { domainName: withoutProtocol, stageName: '' };
    }

    return {
      domainName: withoutProtocol.substring(0, slashIndex),
      stageName: withoutProtocol.substring(slashIndex + 1),
    };
  }
}
