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

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Users table: PK=userId, GSIs: email-index, wechatOpenId-index
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
  }
}
