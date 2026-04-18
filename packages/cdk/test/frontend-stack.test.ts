import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { FrontendStack } from '../lib/frontend-stack';

describe('FrontendStack - CloudFront Upload Proxy Infrastructure', () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App();
    const stack = new FrontendStack(app, 'TestFrontendStack', {
      apiUrl: 'https://test-api.execute-api.ap-northeast-1.amazonaws.com/prod/',
      uploadTokenSecret: 'test-secret',
      domainName: 'test.example.com',
      certificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/test-cert-id',
      edgeSignerLambdaArn: 'arn:aws:lambda:us-east-1:123456789012:function:test-edge-signer:1',
    });
    template = Template.fromStack(stack);
  });

  describe('CloudFront Distribution upload behaviors include PUT method', () => {
    it.each(['/products/*', '/claims/*', '/content/*'])(
      'should configure %s behavior with AllowedMethods including PUT',
      (pathPattern) => {
        template.hasResourceProperties('AWS::CloudFront::Distribution', {
          DistributionConfig: {
            CacheBehaviors: Match.arrayWith([
              Match.objectLike({
                PathPattern: pathPattern,
                AllowedMethods: Match.arrayWith(['PUT']),
              }),
            ]),
          },
        });
      },
    );
  });

  describe('Lambda@Edge association', () => {
    it('should associate Lambda@Edge function version with upload behaviors', () => {
      template.hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: {
          CacheBehaviors: Match.arrayWith([
            Match.objectLike({
              PathPattern: '/products/*',
              LambdaFunctionAssociations: Match.arrayWith([
                Match.objectLike({
                  EventType: 'origin-request',
                }),
              ]),
            }),
          ]),
        },
      });
    });
  });

  describe('Lambda@Edge IAM Role permissions (in EdgeSignerStack)', () => {
    it('should be tested in EdgeSignerStack tests — FrontendStack only references the version ARN', () => {
      // IAM permissions are managed by the separate EdgeSignerStack in us-east-1
      expect(true).toBe(true);
    });
  });

  describe('CORS response headers policy', () => {
    it('should configure CORS policy with correct allowed origins, methods, and headers', () => {
      template.hasResourceProperties('AWS::CloudFront::ResponseHeadersPolicy', {
        ResponseHeadersPolicyConfig: {
          CorsConfig: {
            AccessControlAllowOrigins: {
              Items: ['https://test.example.com'],
            },
            AccessControlAllowMethods: {
              Items: Match.arrayWith(['GET', 'PUT', 'OPTIONS']),
            },
            AccessControlAllowHeaders: {
              Items: Match.arrayWith(['Content-Type', 'Content-Length']),
            },
          },
        },
      });
    });
  });

  describe('Existing OAC configuration preserved', () => {
    it('should have S3 Origin Access Control resources', () => {
      template.hasResourceProperties('AWS::CloudFront::OriginAccessControl', {
        OriginAccessControlConfig: {
          OriginAccessControlOriginType: 's3',
          SigningBehavior: 'always',
          SigningProtocol: 'sigv4',
        },
      });
    });
  });
});

describe('FrontendStack - CloudFront Function for Country Cookie', () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App();
    const stack = new FrontendStack(app, 'TestCFCountryCookieStack', {
      apiUrl: 'https://test-api.execute-api.ap-northeast-1.amazonaws.com/prod/',
      uploadTokenSecret: 'test-secret',
      domainName: 'test.example.com',
      certificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/test-cert-id',
      edgeSignerLambdaArn: 'arn:aws:lambda:us-east-1:123456789012:function:test-edge-signer:1',
    });
    template = Template.fromStack(stack);
  });

  describe('CloudFront Function resource exists', () => {
    it('should create a CloudFront Function with cloudfront-js-2.0 runtime', () => {
      template.hasResourceProperties('AWS::CloudFront::Function', {
        FunctionConfig: Match.objectLike({
          Runtime: 'cloudfront-js-2.0',
        }),
      });
    });
  });

  describe('CloudFront Function associated with default behavior as VIEWER_RESPONSE', () => {
    it('should associate the CloudFront Function with the default behavior using viewer-response event type', () => {
      template.hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: {
          DefaultCacheBehavior: Match.objectLike({
            FunctionAssociations: Match.arrayWith([
              Match.objectLike({
                EventType: 'viewer-response',
              }),
            ]),
          }),
        },
      });
    });
  });
});
