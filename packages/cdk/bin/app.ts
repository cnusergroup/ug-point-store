#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { DatabaseStack } from '../lib/database-stack';
import { ApiStack } from '../lib/api-stack';
import { FrontendStack } from '../lib/frontend-stack';
import { EdgeSignerStack } from '../lib/edge-signer-stack';

const app = new cdk.App();

// Read configuration from CDK context (--context flags or cdk.json)
const jwtSecret = app.node.tryGetContext('jwtSecret') ?? 'change-me-in-production';
const wechatAppId = app.node.tryGetContext('wechatAppId') ?? '';
const wechatAppSecret = app.node.tryGetContext('wechatAppSecret') ?? '';
const wechatRedirectUri = app.node.tryGetContext('wechatRedirectUri') ?? '';
const senderEmail = app.node.tryGetContext('senderEmail') ?? '';
const uploadTokenSecret = app.node.tryGetContext('uploadTokenSecret') ?? 'change-me-in-production';
const uploadViaCloudfront = app.node.tryGetContext('uploadViaCloudfront') ?? 'false';
// Pass the edge signer Lambda version ARN after deploying EdgeSignerStack
const edgeSignerLambdaArn = app.node.tryGetContext('edgeSignerLambdaArn') ?? '';

const databaseStack = new DatabaseStack(app, 'PointsMall-DatabaseStack', {
  description: 'Points Mall - DynamoDB tables',
});

const apiStack = new ApiStack(app, 'PointsMall-ApiStack', {
  description: 'Points Mall - API Gateway and Lambda functions',
  usersTable: databaseStack.usersTable,
  productsTable: databaseStack.productsTable,
  codesTable: databaseStack.codesTable,
  redemptionsTable: databaseStack.redemptionsTable,
  pointsRecordsTable: databaseStack.pointsRecordsTable,
  cartTable: databaseStack.cartTable,
  addressesTable: databaseStack.addressesTable,
  ordersTable: databaseStack.ordersTable,
  invitesTable: databaseStack.invitesTable,
  claimsTable: databaseStack.claimsTable,
  contentItemsTable: databaseStack.contentItemsTable,
  contentCategoriesTable: databaseStack.contentCategoriesTable,
  contentCommentsTable: databaseStack.contentCommentsTable,
  contentLikesTable: databaseStack.contentLikesTable,
  contentReservationsTable: databaseStack.contentReservationsTable,
  batchDistributionsTable: databaseStack.batchDistributionsTable,
  travelApplicationsTable: databaseStack.travelApplicationsTable,
  contentTagsTable: databaseStack.contentTagsTable,
  emailTemplatesTable: databaseStack.emailTemplatesTable,
  jwtSecret,
  wechatAppId,
  wechatAppSecret,
  wechatRedirectUri,
  senderEmail,
});
apiStack.addDependency(databaseStack);

const frontendStack = new FrontendStack(app, 'PointsMall-FrontendStack', {
  description: 'Points Mall - S3 buckets and CloudFront distribution',
  apiUrl: apiStack.api.url,
  uploadTokenSecret,
  edgeSignerLambdaArn: edgeSignerLambdaArn || undefined,
  domainName: app.node.tryGetContext('domainName') ?? 'store.awscommunity.cn',
  certificateArn: app.node.tryGetContext('certificateArn')
    ?? 'arn:aws:acm:us-east-1:778409058172:certificate/1e9c7abe-e4b1-4a39-95e1-00deb0cf2c46',
});
frontendStack.addDependency(apiStack);

// Pass imagesBucket info from FrontendStack to ApiStack using Fn.importValue
const imagesBucketName = cdk.Fn.importValue('PointsMall-ImagesBucketName');
const imagesBucketArn = cdk.Fn.join('', ['arn:aws:s3:::', imagesBucketName]);
apiStack.configureImagesBucket(imagesBucketName, imagesBucketArn, uploadViaCloudfront, uploadTokenSecret);

// --- Lambda@Edge Stack (us-east-1) ---
// Deploy workflow:
//   1) npx cdk deploy PointsMall-EdgeSignerStack
//   2) Copy EdgeSignerFunctionArn output → update edgeSignerLambdaArn in cdk.json
//   3) npx cdk deploy --all
// Note: edgeSignerLambdaArn in cdk.json must be updated whenever EdgeSignerStack Lambda code changes.
const imagesBucketArnForEdge = app.node.tryGetContext('imagesBucketArn') || 'arn:aws:s3:::*';

new EdgeSignerStack(app, 'PointsMall-EdgeSignerStack', {
  description: 'Points Mall - Lambda@Edge for CloudFront upload signing (us-east-1)',
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'us-east-1',  // Lambda@Edge must be in us-east-1
  },
  uploadTokenSecret,
  imagesBucketArn: imagesBucketArnForEdge,
});
