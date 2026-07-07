import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { DatabaseStack } from '../lib/database-stack';
import { ApiStack } from '../lib/api-stack';

describe('ApiStack - UGLExit Lambda and EventBridge schedules', () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App();
    const databaseStack = new DatabaseStack(app, 'TestDatabaseStackForApi');
    const stack = new ApiStack(app, 'TestApiStack', {
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
      awardTagsTable: databaseStack.awardTagsTable,
      rewardTagsTable: databaseStack.rewardTagsTable,
      emailTemplatesTable: databaseStack.emailTemplatesTable,
      ugsTable: databaseStack.ugsTable,
      activitiesTable: databaseStack.activitiesTable,
      credentialsTable: databaseStack.credentialsTable,
      credentialSequencesTable: databaseStack.credentialSequencesTable,
      activityTemplateAssociationsTable: databaseStack.activityTemplateAssociationsTable,
      wishesTable: databaseStack.wishesTable,
      wishVotesTable: databaseStack.wishVotesTable,
      activitySkillClaimsTable: databaseStack.activitySkillClaimsTable,
      queryCredentialsTable: databaseStack.queryCredentialsTable,
      queryLoginAttemptsTable: databaseStack.queryLoginAttemptsTable,
      uglReminderTrackingTable: databaseStack.uglReminderTrackingTable,
      jwtSecret: 'test-jwt-secret',
      queryJwtSecret: 'test-query-jwt-secret',
      queryDefaultUsername: 'test-query-user',
      queryDefaultPassword: 'test-query-password-123',
      wechatAppId: 'test-wechat-app-id',
      wechatAppSecret: 'test-wechat-app-secret',
      wechatRedirectUri: 'https://test.example.com/wechat/callback',
      senderEmail: 'test-sender@example.com',
    });
    template = Template.fromStack(stack);
  }, 60000);

  it('should create the PointsMall-UGLExit Lambda function', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'PointsMall-UGLExit',
      Handler: 'index.handler',
      Runtime: 'nodejs20.x',
    });
  });

  it('should create the quarterly detection EventBridge rule targeting UGLExit with jobType=detection', () => {
    const rules = template.findResources('AWS::Events::Rule', {
      Properties: Match.objectLike({ Name: 'PointsMall-UGLExitDetectionSchedule' }),
    });
    const ruleKeys = Object.keys(rules);
    expect(ruleKeys.length).toBe(1);

    const rule = rules[ruleKeys[0]];
    expect(rule.Properties.ScheduleExpression).toBe('cron(0 0 1 1,4,7,10 ? *)');

    const target = rule.Properties.Targets[0];
    expect(JSON.parse(target.Input)).toEqual({ jobType: 'detection' });
  });

  it('should create the daily grace-period EventBridge rule targeting UGLExit with jobType=graceEvaluation', () => {
    const rules = template.findResources('AWS::Events::Rule', {
      Properties: Match.objectLike({ Name: 'PointsMall-UGLExitGracePeriodSchedule' }),
    });
    const ruleKeys = Object.keys(rules);
    expect(ruleKeys.length).toBe(1);

    const rule = rules[ruleKeys[0]];
    expect(rule.Properties.ScheduleExpression).toBe('rate(1 day)');

    const target = rule.Properties.Targets[0];
    expect(JSON.parse(target.Input)).toEqual({ jobType: 'graceEvaluation' });
  });

  it('should target the UGLExit Lambda function from both EventBridge rules', () => {
    const lambdaResources = template.findResources('AWS::Lambda::Function', {
      Properties: Match.objectLike({ FunctionName: 'PointsMall-UGLExit' }),
    });
    const lambdaLogicalIds = Object.keys(lambdaResources);
    expect(lambdaLogicalIds.length).toBe(1);
    const uglExitLambdaLogicalId = lambdaLogicalIds[0];

    const detectionRules = template.findResources('AWS::Events::Rule', {
      Properties: Match.objectLike({ Name: 'PointsMall-UGLExitDetectionSchedule' }),
    });
    const graceRules = template.findResources('AWS::Events::Rule', {
      Properties: Match.objectLike({ Name: 'PointsMall-UGLExitGracePeriodSchedule' }),
    });

    const detectionTargetArn = Object.values(detectionRules)[0].Properties.Targets[0].Arn;
    const graceTargetArn = Object.values(graceRules)[0].Properties.Targets[0].Arn;

    expect(detectionTargetArn).toEqual({ 'Fn::GetAtt': [uglExitLambdaLogicalId, 'Arn'] });
    expect(graceTargetArn).toEqual({ 'Fn::GetAtt': [uglExitLambdaLogicalId, 'Arn'] });
  });
});
