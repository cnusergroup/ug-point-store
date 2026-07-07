import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export class DatabaseStack extends cdk.Stack {
  public readonly usersTable: dynamodb.Table;
  public readonly productsTable: dynamodb.Table;
  public readonly codesTable: dynamodb.Table;
  public readonly redemptionsTable: dynamodb.Table;
  public readonly pointsRecordsTable: dynamodb.Table;
  public readonly cartTable: dynamodb.Table;
  public readonly addressesTable: dynamodb.Table;
  public readonly ordersTable: dynamodb.Table;
  public readonly invitesTable: dynamodb.Table;
  public readonly claimsTable: dynamodb.Table;
  public readonly contentItemsTable: dynamodb.Table;
  public readonly contentCategoriesTable: dynamodb.Table;
  public readonly contentCommentsTable: dynamodb.Table;
  public readonly contentLikesTable: dynamodb.Table;
  public readonly contentReservationsTable: dynamodb.Table;
  public readonly batchDistributionsTable: dynamodb.Table;
  public readonly travelApplicationsTable: dynamodb.Table;
  public readonly contentTagsTable: dynamodb.Table;
  public readonly awardTagsTable: dynamodb.Table;
  public readonly rewardTagsTable: dynamodb.Table;
  public readonly emailTemplatesTable: dynamodb.Table;
  public readonly ugsTable: dynamodb.Table;
  public readonly activitiesTable: dynamodb.Table;
  public readonly credentialsTable: dynamodb.Table;
  public readonly credentialSequencesTable: dynamodb.Table;
  public readonly activityTemplateAssociationsTable: dynamodb.Table;
  public readonly wishesTable: dynamodb.Table;
  public readonly wishVotesTable: dynamodb.Table;
  public readonly activitySkillClaimsTable: dynamodb.Table;
  public readonly queryCredentialsTable: dynamodb.Table;
  public readonly queryLoginAttemptsTable: dynamodb.Table;
  public readonly uglReminderTrackingTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Users table: PK=userId, GSIs: email-index, wechatOpenId-index
    //
    // ugl-inactivity-exit-flow feature note: this table gains three new
    // non-key attributes on user items (no schema/GSI change required):
    //   - uglExitStatus: 'pending_exit' | absent — set when a UGL is marked
    //     fully inactive after the 30-day grace period with no makeup activity
    //   - uglExitTriggeredQuarter: string (e.g. '2025-Q2') — the detection
    //     quarter that triggered the pending-exit state
    //   - uglExitMarkedAt: ISO string — when uglExitStatus was set
    // The existing 'entityType-createdAt-index' GSI (below) is reused with a
    // FilterExpression (uglExitStatus = 'pending_exit') to list pending-exit
    // UGLs for SuperAdmin review — no new GSI needed.
    this.usersTable = new dynamodb.Table(this, 'UsersTable', {
      tableName: 'PointsMall-Users',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.usersTable.addGlobalSecondaryIndex({
      indexName: 'email-index',
      partitionKey: { name: 'email', type: dynamodb.AttributeType.STRING },
    });

    this.usersTable.addGlobalSecondaryIndex({
      indexName: 'wechatOpenId-index',
      partitionKey: { name: 'wechatOpenId', type: dynamodb.AttributeType.STRING },
    });

    this.usersTable.addGlobalSecondaryIndex({
      indexName: 'earnTotal-index',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'earnTotal', type: dynamodb.AttributeType.NUMBER },
    });

    // Per-role earnTotal GSIs for role-specific leaderboards
    // NOTE: DynamoDB only allows one GSI creation per CloudFormation update.
    // Deploy these one at a time: Speaker first, then Leader, then Volunteer.
    this.usersTable.addGlobalSecondaryIndex({
      indexName: 'earnTotalSpeaker-index',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'earnTotalSpeaker', type: dynamodb.AttributeType.NUMBER },
    });

    this.usersTable.addGlobalSecondaryIndex({
      indexName: 'earnTotalLeader-index',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'earnTotalLeader', type: dynamodb.AttributeType.NUMBER },
    });

    this.usersTable.addGlobalSecondaryIndex({
      indexName: 'earnTotalVolunteer-index',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'earnTotalVolunteer', type: dynamodb.AttributeType.NUMBER },
    });

    // GSI for the SpecialActivity leaderboard / reports column.
    // NOTE: DynamoDB only allows one GSI creation per CloudFormation update —
    // this is the ONLY new GSI being added to the Users table in the
    // special-activity-award deployment batch. Deploy and wait for ACTIVE state
    // before deploying any Lambda code that queries this index.
    this.usersTable.addGlobalSecondaryIndex({
      indexName: 'earnTotalSpecialActivity-index',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'earnTotalSpecialActivity', type: dynamodb.AttributeType.NUMBER },
    });

    // GSI for paginated user listing: partition by entityType, sort by createdAt
    // NOTE: DynamoDB only allows one GSI creation per CloudFormation update — deploy this GSI alone before proceeding
    this.usersTable.addGlobalSecondaryIndex({
      indexName: 'entityType-createdAt-index',
      partitionKey: { name: 'entityType', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI for the SpecialReward leaderboard / reports column.
    // NOTE: DynamoDB only allows one GSI creation per CloudFormation update —
    // this is the ONLY new GSI being added to the Users table in the
    // special-reward-award deployment batch. Deploy and wait for ACTIVE state
    // before deploying any Lambda code that queries this index.
    this.usersTable.addGlobalSecondaryIndex({
      indexName: 'earnTotalSpecialReward-index',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'earnTotalSpecialReward', type: dynamodb.AttributeType.NUMBER },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Products table: PK=productId, GSI: type-status-index (PK=type, SK=status)
    this.productsTable = new dynamodb.Table(this, 'ProductsTable', {
      tableName: 'PointsMall-Products',
      partitionKey: { name: 'productId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.productsTable.addGlobalSecondaryIndex({
      indexName: 'type-status-index',
      partitionKey: { name: 'type', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'status', type: dynamodb.AttributeType.STRING },
    });

    // Codes table: PK=codeId, GSI: codeValue-index (PK=codeValue)
    this.codesTable = new dynamodb.Table(this, 'CodesTable', {
      tableName: 'PointsMall-Codes',
      partitionKey: { name: 'codeId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.codesTable.addGlobalSecondaryIndex({
      indexName: 'codeValue-index',
      partitionKey: { name: 'codeValue', type: dynamodb.AttributeType.STRING },
    });

    // Redemptions table: PK=redemptionId, GSI: userId-createdAt-index (PK=userId, SK=createdAt)
    this.redemptionsTable = new dynamodb.Table(this, 'RedemptionsTable', {
      tableName: 'PointsMall-Redemptions',
      partitionKey: { name: 'redemptionId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.redemptionsTable.addGlobalSecondaryIndex({
      indexName: 'userId-createdAt-index',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });

    // PointsRecords table: PK=recordId, GSI: userId-createdAt-index (PK=userId, SK=createdAt)
    //
    // ugl-inactivity-exit-flow feature note: this table gains one new
    // non-key attribute on records (no schema/GSI change required):
    //   - consumedForQuarter: string (e.g. '2025-Q2') — set once a record has
    //     been counted as satisfying UGL activity for a quarter (detection)
    //     or as a grace-period makeup record, so it cannot be double-counted
    //     for another quarter/grace-period evaluation
    // The existing 'type-createdAt-index' and 'userId-createdAt-index' GSIs
    // (below) are reused with a FilterExpression (targetRole = 'UserGroupLeader'
    // AND consumedForQuarter not exists) for both the quarterly detection job
    // and the grace-period makeup query — no new GSI needed.
    this.pointsRecordsTable = new dynamodb.Table(this, 'PointsRecordsTable', {
      tableName: 'PointsMall-PointsRecords',
      partitionKey: { name: 'recordId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.pointsRecordsTable.addGlobalSecondaryIndex({
      indexName: 'userId-createdAt-index',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });

    this.pointsRecordsTable.addGlobalSecondaryIndex({
      indexName: 'type-createdAt-index',
      partitionKey: { name: 'type', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });

    // CloudFormation outputs for cross-stack references
    new cdk.CfnOutput(this, 'UsersTableName', { value: this.usersTable.tableName, exportName: 'PointsMall-UsersTableName' });
    new cdk.CfnOutput(this, 'UsersTableArn', { value: this.usersTable.tableArn, exportName: 'PointsMall-UsersTableArn' });

    new cdk.CfnOutput(this, 'ProductsTableName', { value: this.productsTable.tableName, exportName: 'PointsMall-ProductsTableName' });
    new cdk.CfnOutput(this, 'ProductsTableArn', { value: this.productsTable.tableArn, exportName: 'PointsMall-ProductsTableArn' });

    new cdk.CfnOutput(this, 'CodesTableName', { value: this.codesTable.tableName, exportName: 'PointsMall-CodesTableName' });
    new cdk.CfnOutput(this, 'CodesTableArn', { value: this.codesTable.tableArn, exportName: 'PointsMall-CodesTableArn' });

    new cdk.CfnOutput(this, 'RedemptionsTableName', { value: this.redemptionsTable.tableName, exportName: 'PointsMall-RedemptionsTableName' });
    new cdk.CfnOutput(this, 'RedemptionsTableArn', { value: this.redemptionsTable.tableArn, exportName: 'PointsMall-RedemptionsTableArn' });

    new cdk.CfnOutput(this, 'PointsRecordsTableName', { value: this.pointsRecordsTable.tableName, exportName: 'PointsMall-PointsRecordsTableName' });
    new cdk.CfnOutput(this, 'PointsRecordsTableArn', { value: this.pointsRecordsTable.tableArn, exportName: 'PointsMall-PointsRecordsTableArn' });

    // Cart table: PK=userId
    this.cartTable = new dynamodb.Table(this, 'CartTable', {
      tableName: 'PointsMall-Cart',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Addresses table: PK=addressId, GSI: userId-index (PK=userId)
    this.addressesTable = new dynamodb.Table(this, 'AddressesTable', {
      tableName: 'PointsMall-Addresses',
      partitionKey: { name: 'addressId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.addressesTable.addGlobalSecondaryIndex({
      indexName: 'userId-index',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
    });

    // Orders table: PK=orderId, GSI: userId-createdAt-index (PK=userId, SK=createdAt), shippingStatus-createdAt-index (PK=shippingStatus, SK=createdAt)
    this.ordersTable = new dynamodb.Table(this, 'OrdersTable', {
      tableName: 'PointsMall-Orders',
      partitionKey: { name: 'orderId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.ordersTable.addGlobalSecondaryIndex({
      indexName: 'userId-createdAt-index',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });

    this.ordersTable.addGlobalSecondaryIndex({
      indexName: 'shippingStatus-createdAt-index',
      partitionKey: { name: 'shippingStatus', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });

    new cdk.CfnOutput(this, 'CartTableName', { value: this.cartTable.tableName, exportName: 'PointsMall-CartTableName' });
    new cdk.CfnOutput(this, 'CartTableArn', { value: this.cartTable.tableArn, exportName: 'PointsMall-CartTableArn' });

    new cdk.CfnOutput(this, 'AddressesTableName', { value: this.addressesTable.tableName, exportName: 'PointsMall-AddressesTableName' });
    new cdk.CfnOutput(this, 'AddressesTableArn', { value: this.addressesTable.tableArn, exportName: 'PointsMall-AddressesTableArn' });

    new cdk.CfnOutput(this, 'OrdersTableName', { value: this.ordersTable.tableName, exportName: 'PointsMall-OrdersTableName' });
    new cdk.CfnOutput(this, 'OrdersTableArn', { value: this.ordersTable.tableArn, exportName: 'PointsMall-OrdersTableArn' });

    // Invites table: PK=token, GSI: status-createdAt-index (PK=status, SK=createdAt)
    this.invitesTable = new dynamodb.Table(this, 'InvitesTable', {
      tableName: 'PointsMall-Invites',
      partitionKey: { name: 'token', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.invitesTable.addGlobalSecondaryIndex({
      indexName: 'status-createdAt-index',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });

    new cdk.CfnOutput(this, 'InvitesTableName', { value: this.invitesTable.tableName, exportName: 'PointsMall-InvitesTableName' });
    new cdk.CfnOutput(this, 'InvitesTableArn', { value: this.invitesTable.tableArn, exportName: 'PointsMall-InvitesTableArn' });

    // Claims table: PK=claimId, GSI: userId-createdAt-index (PK=userId, SK=createdAt), status-createdAt-index (PK=status, SK=createdAt)
    this.claimsTable = new dynamodb.Table(this, 'ClaimsTable', {
      tableName: 'PointsMall-Claims',
      partitionKey: { name: 'claimId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.claimsTable.addGlobalSecondaryIndex({
      indexName: 'userId-createdAt-index',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });

    this.claimsTable.addGlobalSecondaryIndex({
      indexName: 'status-createdAt-index',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });

    new cdk.CfnOutput(this, 'ClaimsTableName', { value: this.claimsTable.tableName, exportName: 'PointsMall-ClaimsTableName' });
    new cdk.CfnOutput(this, 'ClaimsTableArn', { value: this.claimsTable.tableArn, exportName: 'PointsMall-ClaimsTableArn' });

    // ContentItems table: PK=contentId, GSIs: status-createdAt-index, categoryId-createdAt-index, uploaderId-createdAt-index
    this.contentItemsTable = new dynamodb.Table(this, 'ContentItemsTable', {
      tableName: 'PointsMall-ContentItems',
      partitionKey: { name: 'contentId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.contentItemsTable.addGlobalSecondaryIndex({
      indexName: 'status-createdAt-index',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });

    this.contentItemsTable.addGlobalSecondaryIndex({
      indexName: 'categoryId-createdAt-index',
      partitionKey: { name: 'categoryId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });

    this.contentItemsTable.addGlobalSecondaryIndex({
      indexName: 'uploaderId-createdAt-index',
      partitionKey: { name: 'uploaderId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });

    new cdk.CfnOutput(this, 'ContentItemsTableName', { value: this.contentItemsTable.tableName, exportName: 'PointsMall-ContentItemsTableName' });
    new cdk.CfnOutput(this, 'ContentItemsTableArn', { value: this.contentItemsTable.tableArn, exportName: 'PointsMall-ContentItemsTableArn' });

    // ContentCategories table: PK=categoryId
    this.contentCategoriesTable = new dynamodb.Table(this, 'ContentCategoriesTable', {
      tableName: 'PointsMall-ContentCategories',
      partitionKey: { name: 'categoryId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    new cdk.CfnOutput(this, 'ContentCategoriesTableName', { value: this.contentCategoriesTable.tableName, exportName: 'PointsMall-ContentCategoriesTableName' });
    new cdk.CfnOutput(this, 'ContentCategoriesTableArn', { value: this.contentCategoriesTable.tableArn, exportName: 'PointsMall-ContentCategoriesTableArn' });

    // ContentComments table: PK=commentId, GSI: contentId-createdAt-index
    this.contentCommentsTable = new dynamodb.Table(this, 'ContentCommentsTable', {
      tableName: 'PointsMall-ContentComments',
      partitionKey: { name: 'commentId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.contentCommentsTable.addGlobalSecondaryIndex({
      indexName: 'contentId-createdAt-index',
      partitionKey: { name: 'contentId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });

    new cdk.CfnOutput(this, 'ContentCommentsTableName', { value: this.contentCommentsTable.tableName, exportName: 'PointsMall-ContentCommentsTableName' });
    new cdk.CfnOutput(this, 'ContentCommentsTableArn', { value: this.contentCommentsTable.tableArn, exportName: 'PointsMall-ContentCommentsTableArn' });

    // ContentLikes table: PK=pk, GSI: contentId-index
    this.contentLikesTable = new dynamodb.Table(this, 'ContentLikesTable', {
      tableName: 'PointsMall-ContentLikes',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.contentLikesTable.addGlobalSecondaryIndex({
      indexName: 'contentId-index',
      partitionKey: { name: 'contentId', type: dynamodb.AttributeType.STRING },
    });

    new cdk.CfnOutput(this, 'ContentLikesTableName', { value: this.contentLikesTable.tableName, exportName: 'PointsMall-ContentLikesTableName' });
    new cdk.CfnOutput(this, 'ContentLikesTableArn', { value: this.contentLikesTable.tableArn, exportName: 'PointsMall-ContentLikesTableArn' });

    // ContentReservations table: PK=pk, GSI: contentId-index
    this.contentReservationsTable = new dynamodb.Table(this, 'ContentReservationsTable', {
      tableName: 'PointsMall-ContentReservations',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.contentReservationsTable.addGlobalSecondaryIndex({
      indexName: 'contentId-index',
      partitionKey: { name: 'contentId', type: dynamodb.AttributeType.STRING },
    });

    this.contentReservationsTable.addGlobalSecondaryIndex({
      indexName: 'status-createdAt-index',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });

    this.contentReservationsTable.addGlobalSecondaryIndex({
      indexName: 'userId-activityId-index',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'activityId', type: dynamodb.AttributeType.STRING },
    });

    new cdk.CfnOutput(this, 'ContentReservationsTableName', { value: this.contentReservationsTable.tableName, exportName: 'PointsMall-ContentReservationsTableName' });
    new cdk.CfnOutput(this, 'ContentReservationsTableArn', { value: this.contentReservationsTable.tableArn, exportName: 'PointsMall-ContentReservationsTableArn' });

    // BatchDistributions table: PK=distributionId, GSI: createdAt-index (PK=pk, SK=createdAt)
    this.batchDistributionsTable = new dynamodb.Table(this, 'BatchDistributionsTable', {
      tableName: 'PointsMall-BatchDistributions',
      partitionKey: { name: 'distributionId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.batchDistributionsTable.addGlobalSecondaryIndex({
      indexName: 'createdAt-index',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });

    new cdk.CfnOutput(this, 'BatchDistributionsTableName', { value: this.batchDistributionsTable.tableName, exportName: 'PointsMall-BatchDistributionsTableName' });
    new cdk.CfnOutput(this, 'BatchDistributionsTableArn', { value: this.batchDistributionsTable.tableArn, exportName: 'PointsMall-BatchDistributionsTableArn' });

    // TravelApplications table: PK=applicationId, GSI: userId-createdAt-index, status-createdAt-index
    this.travelApplicationsTable = new dynamodb.Table(this, 'TravelApplicationsTable', {
      tableName: 'PointsMall-TravelApplications',
      partitionKey: { name: 'applicationId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.travelApplicationsTable.addGlobalSecondaryIndex({
      indexName: 'userId-createdAt-index',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });

    this.travelApplicationsTable.addGlobalSecondaryIndex({
      indexName: 'status-createdAt-index',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });

    new cdk.CfnOutput(this, 'TravelApplicationsTableName', { value: this.travelApplicationsTable.tableName, exportName: 'PointsMall-TravelApplicationsTableName' });
    new cdk.CfnOutput(this, 'TravelApplicationsTableArn', { value: this.travelApplicationsTable.tableArn, exportName: 'PointsMall-TravelApplicationsTableArn' });

    // ContentTags table: PK=tagId, GSI: tagName-index
    this.contentTagsTable = new dynamodb.Table(this, 'ContentTagsTable', {
      tableName: 'PointsMall-ContentTags',
      partitionKey: { name: 'tagId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.contentTagsTable.addGlobalSecondaryIndex({
      indexName: 'tagName-index',
      partitionKey: { name: 'tagName', type: dynamodb.AttributeType.STRING },
    });

    new cdk.CfnOutput(this, 'ContentTagsTableName', { value: this.contentTagsTable.tableName, exportName: 'PointsMall-ContentTagsTableName' });
    new cdk.CfnOutput(this, 'ContentTagsTableArn', { value: this.contentTagsTable.tableArn, exportName: 'PointsMall-ContentTagsTableArn' });

    // AwardTags table: PK=tagId, GSI: tagName-index
    // Used by special-activity-award feature to manage award tag metadata.
    // Fully isolated from ContentTags table (no shared API, no shared GSI).
    this.awardTagsTable = new dynamodb.Table(this, 'AwardTagsTable', {
      tableName: 'PointsMall-AwardTags',
      partitionKey: { name: 'tagId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.awardTagsTable.addGlobalSecondaryIndex({
      indexName: 'tagName-index',
      partitionKey: { name: 'tagName', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    new cdk.CfnOutput(this, 'AwardTagsTableName', { value: this.awardTagsTable.tableName, exportName: 'PointsMall-AwardTagsTableName' });
    new cdk.CfnOutput(this, 'AwardTagsTableArn', { value: this.awardTagsTable.tableArn, exportName: 'PointsMall-AwardTagsTableArn' });

    // RewardTags table: PK=tagId, GSI: tagName-index
    // Used by special-reward-award feature to manage reward tag metadata.
    // Fully isolated from ContentTags / AwardTags tables (no shared API, no shared GSI).
    this.rewardTagsTable = new dynamodb.Table(this, 'RewardTagsTable', {
      tableName: 'PointsMall-RewardTags',
      partitionKey: { name: 'tagId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.rewardTagsTable.addGlobalSecondaryIndex({
      indexName: 'tagName-index',
      partitionKey: { name: 'tagName', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    new cdk.CfnOutput(this, 'RewardTagsTableName', { value: this.rewardTagsTable.tableName, exportName: 'PointsMall-RewardTagsTableName' });
    new cdk.CfnOutput(this, 'RewardTagsTableArn', { value: this.rewardTagsTable.tableArn, exportName: 'PointsMall-RewardTagsTableArn' });

    // EmailTemplates table: PK=templateId, SK=locale
    this.emailTemplatesTable = new dynamodb.Table(this, 'EmailTemplatesTable', {
      tableName: 'PointsMall-EmailTemplates',
      partitionKey: { name: 'templateId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'locale', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    new cdk.CfnOutput(this, 'EmailTemplatesTableName', { value: this.emailTemplatesTable.tableName, exportName: 'PointsMall-EmailTemplatesTableName' });
    new cdk.CfnOutput(this, 'EmailTemplatesTableArn', { value: this.emailTemplatesTable.tableArn, exportName: 'PointsMall-EmailTemplatesTableArn' });

    // UGs table: PK=ugId, GSI: name-index (PK=name), status-index (PK=status, SK=createdAt)
    this.ugsTable = new dynamodb.Table(this, 'UGsTable', {
      tableName: 'PointsMall-UGs',
      partitionKey: { name: 'ugId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.ugsTable.addGlobalSecondaryIndex({
      indexName: 'name-index',
      partitionKey: { name: 'name', type: dynamodb.AttributeType.STRING },
    });

    this.ugsTable.addGlobalSecondaryIndex({
      indexName: 'status-index',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });

    new cdk.CfnOutput(this, 'UGsTableName', { value: this.ugsTable.tableName, exportName: 'PointsMall-UGsTableName' });
    new cdk.CfnOutput(this, 'UGsTableArn', { value: this.ugsTable.tableArn, exportName: 'PointsMall-UGsTableArn' });

    // Activities table: PK=activityId, GSI: activityDate-index (PK=pk, SK=activityDate), dedupeKey-index (PK=dedupeKey)
    this.activitiesTable = new dynamodb.Table(this, 'ActivitiesTable', {
      tableName: 'PointsMall-Activities',
      partitionKey: { name: 'activityId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.activitiesTable.addGlobalSecondaryIndex({
      indexName: 'activityDate-index',
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'activityDate', type: dynamodb.AttributeType.STRING },
    });

    this.activitiesTable.addGlobalSecondaryIndex({
      indexName: 'dedupeKey-index',
      partitionKey: { name: 'dedupeKey', type: dynamodb.AttributeType.STRING },
    });

    new cdk.CfnOutput(this, 'ActivitiesTableName', { value: this.activitiesTable.tableName, exportName: 'PointsMall-ActivitiesTableName' });
    new cdk.CfnOutput(this, 'ActivitiesTableArn', { value: this.activitiesTable.tableArn, exportName: 'PointsMall-ActivitiesTableArn' });

    // Credentials table: PK=credentialId, GSIs: status-createdAt-index (PK=status, SK=createdAt), batchId-index (PK=batchId)
    this.credentialsTable = new dynamodb.Table(this, 'CredentialsTable', {
      tableName: 'PointsMall-Credentials',
      partitionKey: { name: 'credentialId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.credentialsTable.addGlobalSecondaryIndex({
      indexName: 'status-createdAt-index',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });

    this.credentialsTable.addGlobalSecondaryIndex({
      indexName: 'batchId-index',
      partitionKey: { name: 'batchId', type: dynamodb.AttributeType.STRING },
    });

    // GSI for self-applied credentials: query a user's own credentials sorted by issueDate
    // (credential-self-application feature; PK=appliedByUserId, SK=issueDate).
    // NOTE: DynamoDB only allows one GSI creation per CloudFormation update —
    // deploy this GSI and wait for ACTIVE state before adding the next one.
    this.credentialsTable.addGlobalSecondaryIndex({
      indexName: 'appliedByUserId-index',
      partitionKey: { name: 'appliedByUserId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'issueDate', type: dynamodb.AttributeType.STRING },
    });

    // GSI for self-applied credential dedupe-key lookups (eligibility / apply de-duplication).
    // NOTE: DynamoDB only allows one GSI creation per CloudFormation update —
    // deploy this GSI alone after appliedByUserId-index reaches ACTIVE state.
    this.credentialsTable.addGlobalSecondaryIndex({
      indexName: 'appliedDedupeKey-index',
      partitionKey: { name: 'appliedDedupeKey', type: dynamodb.AttributeType.STRING },
    });

    new cdk.CfnOutput(this, 'CredentialsTableName', { value: this.credentialsTable.tableName, exportName: 'PointsMall-CredentialsTableName' });
    new cdk.CfnOutput(this, 'CredentialsTableArn', { value: this.credentialsTable.tableArn, exportName: 'PointsMall-CredentialsTableArn' });

    // CredentialSequences table: PK=sequenceKey (atomic counter for credential ID sequence generation)
    this.credentialSequencesTable = new dynamodb.Table(this, 'CredentialSequencesTable', {
      tableName: 'PointsMall-CredentialSequences',
      partitionKey: { name: 'sequenceKey', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    new cdk.CfnOutput(this, 'CredentialSequencesTableName', { value: this.credentialSequencesTable.tableName, exportName: 'PointsMall-CredentialSequencesTableName' });
    new cdk.CfnOutput(this, 'CredentialSequencesTableArn', { value: this.credentialSequencesTable.tableArn, exportName: 'PointsMall-CredentialSequencesTableArn' });

    // Wishes table: PK=wishId, GSIs: StatusVoteIndex (PK=status, SK=voteCount), UserWishIndex (PK=userId, SK=createdAt)
    this.wishesTable = new dynamodb.Table(this, 'WishesTable', {
      tableName: 'PointsMall-Wishes',
      partitionKey: { name: 'wishId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.wishesTable.addGlobalSecondaryIndex({
      indexName: 'StatusVoteIndex',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'voteCount', type: dynamodb.AttributeType.NUMBER },
    });

    this.wishesTable.addGlobalSecondaryIndex({
      indexName: 'UserWishIndex',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });

    new cdk.CfnOutput(this, 'WishesTableName', { value: this.wishesTable.tableName, exportName: 'PointsMall-WishesTableName' });
    new cdk.CfnOutput(this, 'WishesTableArn', { value: this.wishesTable.tableArn, exportName: 'PointsMall-WishesTableArn' });

    // WishVotes table: PK=wishId, SK=voterId (composite key prevents duplicate votes)
    this.wishVotesTable = new dynamodb.Table(this, 'WishVotesTable', {
      tableName: 'PointsMall-WishVotes',
      partitionKey: { name: 'wishId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'voterId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    new cdk.CfnOutput(this, 'WishVotesTableName', { value: this.wishVotesTable.tableName, exportName: 'PointsMall-WishVotesTableName' });
    new cdk.CfnOutput(this, 'WishVotesTableArn', { value: this.wishVotesTable.tableArn, exportName: 'PointsMall-WishVotesTableArn' });

    // ActivitySkillClaims table: PK=activityId, SK=skill (global mutex on skill per activity)
    this.activitySkillClaimsTable = new dynamodb.Table(this, 'ActivitySkillClaimsTable', {
      tableName: 'PointsMall-ActivitySkillClaims',
      partitionKey: { name: 'activityId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'skill', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    new cdk.CfnOutput(this, 'ActivitySkillClaimsTableName', { value: this.activitySkillClaimsTable.tableName, exportName: 'PointsMall-ActivitySkillClaimsTableName' });
    new cdk.CfnOutput(this, 'ActivitySkillClaimsTableArn', { value: this.activitySkillClaimsTable.tableArn, exportName: 'PointsMall-ActivitySkillClaimsTableArn' });

    // ActivityTemplateAssociations table: PK=associationId, GSI: activityId-index (PK=activityId)
    // Used by the credential-self-application feature to map activities to certificate templates.
    // Fully isolated from points-mall core data (products, orders, points records, balances).
    this.activityTemplateAssociationsTable = new dynamodb.Table(this, 'ActivityTemplateAssociationsTable', {
      tableName: 'PointsMall-ActivityTemplateAssociations',
      partitionKey: { name: 'associationId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.activityTemplateAssociationsTable.addGlobalSecondaryIndex({
      indexName: 'activityId-index',
      partitionKey: { name: 'activityId', type: dynamodb.AttributeType.STRING },
    });

    new cdk.CfnOutput(this, 'ActivityTemplateAssociationsTableName', { value: this.activityTemplateAssociationsTable.tableName, exportName: 'PointsMall-ActivityTemplateAssociationsTableName' });
    new cdk.CfnOutput(this, 'ActivityTemplateAssociationsTableArn', { value: this.activityTemplateAssociationsTable.tableArn, exportName: 'PointsMall-ActivityTemplateAssociationsTableArn' });

    // QueryCredentials table: PK=username（全局唯一一条记录，员工活动参与度查询系统的登录凭证）
    // 与商城用户账号体系（Users 表）完全隔离，无 GSI。
    this.queryCredentialsTable = new dynamodb.Table(this, 'QueryCredentialsTable', {
      tableName: 'PointsMall-QueryCredentials',
      partitionKey: { name: 'username', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    new cdk.CfnOutput(this, 'QueryCredentialsTableName', { value: this.queryCredentialsTable.tableName, exportName: 'PointsMall-QueryCredentialsTableName' });
    new cdk.CfnOutput(this, 'QueryCredentialsTableArn', { value: this.queryCredentialsTable.tableArn, exportName: 'PointsMall-QueryCredentialsTableArn' });

    // QueryLoginAttempts table: PK=ip（员工活动参与度查询系统按来源 IP 的登录失败锁定状态）
    // 启用 TTL 属性自动清理过期记录，无 GSI。
    this.queryLoginAttemptsTable = new dynamodb.Table(this, 'QueryLoginAttemptsTable', {
      tableName: 'PointsMall-QueryLoginAttempts',
      partitionKey: { name: 'ip', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    new cdk.CfnOutput(this, 'QueryLoginAttemptsTableName', { value: this.queryLoginAttemptsTable.tableName, exportName: 'PointsMall-QueryLoginAttemptsTableName' });
    new cdk.CfnOutput(this, 'QueryLoginAttemptsTableArn', { value: this.queryLoginAttemptsTable.tableArn, exportName: 'PointsMall-QueryLoginAttemptsTableArn' });

    // UGLReminderTracking table: PK=userId, SK=quarter (per-user-per-quarter idempotency backbone
    // for the ugl-inactivity-exit-flow feature's detection + grace-period jobs)
    // GSI: outcome-gracePeriodDeadline-index (PK=outcome, SK=gracePeriodDeadline) — used by the
    // daily grace-period evaluation job to find due tracking records.
    this.uglReminderTrackingTable = new dynamodb.Table(this, 'UGLReminderTrackingTable', {
      tableName: 'PointsMall-UGLReminderTracking',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'quarter', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.uglReminderTrackingTable.addGlobalSecondaryIndex({
      indexName: 'outcome-gracePeriodDeadline-index',
      partitionKey: { name: 'outcome', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gracePeriodDeadline', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    new cdk.CfnOutput(this, 'UGLReminderTrackingTableName', { value: this.uglReminderTrackingTable.tableName, exportName: 'PointsMall-UGLReminderTrackingTableName' });
    new cdk.CfnOutput(this, 'UGLReminderTrackingTableArn', { value: this.uglReminderTrackingTable.tableArn, exportName: 'PointsMall-UGLReminderTrackingTableArn' });
  }
}
