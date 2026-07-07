import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { DatabaseStack } from '../lib/database-stack';

describe('DatabaseStack - UGLReminderTracking table', () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App();
    const stack = new DatabaseStack(app, 'TestDatabaseStack');
    template = Template.fromStack(stack);
  });

  it('should create the PointsMall-UGLReminderTracking table with userId/quarter key schema', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'PointsMall-UGLReminderTracking',
      KeySchema: [
        { AttributeName: 'userId', KeyType: 'HASH' },
        { AttributeName: 'quarter', KeyType: 'RANGE' },
      ],
      AttributeDefinitions: Match.arrayWith([
        { AttributeName: 'userId', AttributeType: 'S' },
        { AttributeName: 'quarter', AttributeType: 'S' },
      ]),
      BillingMode: 'PAY_PER_REQUEST',
    });
  });

  it('should add the outcome-gracePeriodDeadline-index GSI with outcome/gracePeriodDeadline key schema', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'PointsMall-UGLReminderTracking',
      GlobalSecondaryIndexes: Match.arrayWith([
        Match.objectLike({
          IndexName: 'outcome-gracePeriodDeadline-index',
          KeySchema: [
            { AttributeName: 'outcome', KeyType: 'HASH' },
            { AttributeName: 'gracePeriodDeadline', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        }),
      ]),
      AttributeDefinitions: Match.arrayWith([
        { AttributeName: 'outcome', AttributeType: 'S' },
        { AttributeName: 'gracePeriodDeadline', AttributeType: 'S' },
      ]),
    });
  });

  it('should apply DESTROY removal policy consistent with other tables in the stack', () => {
    template.hasResource('AWS::DynamoDB::Table', {
      Properties: Match.objectLike({ TableName: 'PointsMall-UGLReminderTracking' }),
      DeletionPolicy: 'Delete',
      UpdateReplacePolicy: 'Delete',
    });
  });
});
