#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { DatabaseStack } from '../lib/database-stack';
import { ApiStack } from '../lib/api-stack';
import { FrontendStack } from '../lib/frontend-stack';

const app = new cdk.App();

// Read configuration from CDK context (--context flags or cdk.json)
const jwtSecret = app.node.tryGetContext('jwtSecret') ?? 'change-me-in-production';
const wechatAppId = app.node.tryGetContext('wechatAppId') ?? '';
const wechatAppSecret = app.node.tryGetContext('wechatAppSecret') ?? '';
const wechatRedirectUri = app.node.tryGetContext('wechatRedirectUri') ?? '';
const senderEmail = app.node.tryGetContext('senderEmail') ?? '';

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
});
frontendStack.addDependency(apiStack);

// Pass imagesBucket info from FrontendStack to ApiStack using Fn.importValue
// to avoid circular cross-stack construct references.
const imagesBucketName = cdk.Fn.importValue('PointsMall-ImagesBucketName');
const imagesBucketArn = cdk.Fn.join('', ['arn:aws:s3:::', imagesBucketName]);
apiStack.configureImagesBucket(imagesBucketName, imagesBucketArn);
