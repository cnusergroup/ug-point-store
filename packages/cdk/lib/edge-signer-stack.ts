import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export interface EdgeSignerStackProps extends cdk.StackProps {
  /** HMAC secret for upload token verification */
  uploadTokenSecret: string;
  /** S3 bucket ARN for granting PutObject permission */
  imagesBucketArn: string;
  /** Region where the S3 images bucket is deployed (default: ap-northeast-1) */
  imagesBucketRegion?: string;
}

/**
 * Deploys the Lambda@Edge function to us-east-1 (required by CloudFront).
 * Exports the function version ARN via SSM Parameter for cross-region reference.
 */
export class EdgeSignerStack extends cdk.Stack {
  public readonly edgeSignerVersionArn!: string;

  constructor(scope: Construct, id: string, props: EdgeSignerStackProps) {
    super(scope, id, props);

    // IAM Role with both lambda and edgelambda trust
    const role = new iam.Role(this, 'EdgeSignerRole', {
      assumedBy: new iam.CompositePrincipal(
        new iam.ServicePrincipal('lambda.amazonaws.com'),
        new iam.ServicePrincipal('edgelambda.amazonaws.com'),
      ),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // Grant s3:PutObject for upload paths
    role.addToPolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject', 's3:PutObject'],
      resources: [
        `${props.imagesBucketArn}/products/*`,
        `${props.imagesBucketArn}/content/*`,
        `${props.imagesBucketArn}/claims/*`,
      ],
    }));

    // Bundle edge-signer with esbuild locally
    const fn = new lambda.Function(this, 'EdgeSignerFn', {
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/edge-signer'), {
        bundling: {
          image: lambda.Runtime.NODEJS_20_X.bundlingImage,
          local: {
            tryBundle(outputDir: string): boolean {
              const { execSync } = require('child_process');
              const entryPath = path.join(__dirname, '../lambda/edge-signer/index.ts');
              const outFile = path.join(outputDir, 'index.js');
              execSync([
                'npx esbuild',
                JSON.stringify(entryPath),
                '--bundle',
                '--platform=node',
                '--target=node20',
                `--outfile=${JSON.stringify(outFile)}`,
                '--external:aws-sdk',
                `--define:BUCKET_REGION='"${props.imagesBucketRegion ?? 'ap-northeast-1'}"'`,
                `--define:TOKEN_SECRET='"${props.uploadTokenSecret}"'`,
              ].join(' '), { stdio: 'inherit' });
              return true;
            },
          },
          command: ['bash', '-c', 'echo "Docker fallback"'],
        },
      }),
      handler: 'index.handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      role,
      memorySize: 128,
      timeout: cdk.Duration.seconds(5),
    });

    // Publish a version (required for Lambda@Edge)
    const version = fn.currentVersion;

    // Store version ARN in SSM for cross-region reference
    new ssm.StringParameter(this, 'EdgeSignerVersionArn', {
      parameterName: '/points-mall/edge-signer-version-arn',
      stringValue: version.functionArn,
      description: 'Lambda@Edge Edge Signer function version ARN',
    });

    // Outputs
    new cdk.CfnOutput(this, 'EdgeSignerFunctionArn', {
      value: version.functionArn,
      exportName: 'PointsMall-EdgeSignerVersionArn',
    });
  }
}
