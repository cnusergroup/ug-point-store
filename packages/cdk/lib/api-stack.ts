import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as iam from 'aws-cdk-lib/aws-iam';
import { NodejsFunction, NodejsFunctionProps } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

export interface ApiStackProps extends cdk.StackProps {
  usersTable: dynamodb.Table;
  productsTable: dynamodb.Table;
  codesTable: dynamodb.Table;
  redemptionsTable: dynamodb.Table;
  pointsRecordsTable: dynamodb.Table;
  cartTable: dynamodb.Table;
  addressesTable: dynamodb.Table;
  ordersTable: dynamodb.Table;
  invitesTable: dynamodb.Table;
  claimsTable: dynamodb.Table;
  contentItemsTable: dynamodb.Table;
  contentCategoriesTable: dynamodb.Table;
  contentCommentsTable: dynamodb.Table;
  contentLikesTable: dynamodb.Table;
  contentReservationsTable: dynamodb.Table;
  jwtSecret: string;
  wechatAppId: string;
  wechatAppSecret: string;
  wechatRedirectUri: string;
  senderEmail: string;
  verifyBaseUrl?: string;
  resetBaseUrl?: string;
  registerBaseUrl?: string;
}

export class ApiStack extends cdk.Stack {
  public readonly api: apigateway.RestApi;
  private readonly adminFn: NodejsFunction;
  private readonly pointsFn: NodejsFunction;
  private readonly contentFn: NodejsFunction;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const { usersTable, productsTable, codesTable, redemptionsTable, pointsRecordsTable, cartTable, addressesTable, ordersTable, invitesTable, claimsTable, contentItemsTable, contentCategoriesTable, contentCommentsTable, contentLikesTable, contentReservationsTable } = props;

    // --- SSM Parameter for JWT Secret ---
    const jwtSecretParam = new ssm.StringParameter(this, 'JwtSecretParam', {
      parameterName: '/points-mall/jwt-secret',
      description: 'JWT signing secret for Points Mall',
      stringValue: props.jwtSecret,
      tier: ssm.ParameterTier.STANDARD,
    });

    const tableEnv = {
      USERS_TABLE: usersTable.tableName,
      PRODUCTS_TABLE: productsTable.tableName,
      CODES_TABLE: codesTable.tableName,
      REDEMPTIONS_TABLE: redemptionsTable.tableName,
      POINTS_RECORDS_TABLE: pointsRecordsTable.tableName,
      CART_TABLE: cartTable.tableName,
      ADDRESSES_TABLE: addressesTable.tableName,
      ORDERS_TABLE: ordersTable.tableName,
      JWT_SECRET_PARAM: jwtSecretParam.parameterName,
      WECHAT_APP_ID: props.wechatAppId,
      WECHAT_APP_SECRET: props.wechatAppSecret,
      WECHAT_REDIRECT_URI: props.wechatRedirectUri,
      SENDER_EMAIL: props.senderEmail,
      ...(props.verifyBaseUrl ? { VERIFY_BASE_URL: props.verifyBaseUrl } : {}),
      ...(props.resetBaseUrl ? { RESET_BASE_URL: props.resetBaseUrl } : {}),
      INVITES_TABLE: invitesTable.tableName,
      CLAIMS_TABLE: claimsTable.tableName,
      ...(props.registerBaseUrl ? { REGISTER_BASE_URL: props.registerBaseUrl } : {}),
    };

    const backendSrcPath = path.join(__dirname, '../../backend/src');

    const commonFnProps: Partial<NodejsFunctionProps> = {
      runtime: Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: tableEnv,
      bundling: {
        // Bundle all dependencies into a single file
        externalModules: [],
        minify: true,
        sourceMap: false,
        target: 'node20',
      },
    };

    // --- Lambda Functions (NodejsFunction auto-compiles TypeScript via esbuild) ---

    const authFn = new NodejsFunction(this, 'AuthFunction', {
      ...commonFnProps,
      functionName: 'PointsMall-Auth',
      entry: path.join(backendSrcPath, 'auth/handler.ts'),
      handler: 'handler',
    } as NodejsFunctionProps);

    const productFn = new NodejsFunction(this, 'ProductFunction', {
      ...commonFnProps,
      functionName: 'PointsMall-Product',
      entry: path.join(backendSrcPath, 'products/handler.ts'),
      handler: 'handler',
    } as NodejsFunctionProps);

    const pointsFn = new NodejsFunction(this, 'PointsFunction', {
      ...commonFnProps,
      functionName: 'PointsMall-Points',
      entry: path.join(backendSrcPath, 'points/handler.ts'),
      handler: 'handler',
    } as NodejsFunctionProps);
    this.pointsFn = pointsFn;

    const redemptionFn = new NodejsFunction(this, 'RedemptionFunction', {
      ...commonFnProps,
      functionName: 'PointsMall-Redemption',
      entry: path.join(backendSrcPath, 'redemptions/handler.ts'),
      handler: 'handler',
    } as NodejsFunctionProps);

    const adminFn = new NodejsFunction(this, 'AdminFunction', {
      ...commonFnProps,
      functionName: 'PointsMall-Admin',
      entry: path.join(backendSrcPath, 'admin/handler.ts'),
      handler: 'handler',
    } as NodejsFunctionProps);
    this.adminFn = adminFn;
    // Add content table env vars to Admin Lambda
    adminFn.addEnvironment('CONTENT_ITEMS_TABLE', contentItemsTable.tableName);
    adminFn.addEnvironment('CONTENT_CATEGORIES_TABLE', contentCategoriesTable.tableName);
    adminFn.addEnvironment('CONTENT_COMMENTS_TABLE', contentCommentsTable.tableName);
    adminFn.addEnvironment('CONTENT_LIKES_TABLE', contentLikesTable.tableName);
    adminFn.addEnvironment('CONTENT_RESERVATIONS_TABLE', contentReservationsTable.tableName);

    // Note: imagesBucket configuration is done post-construction via configureImagesBucket()

    const cartFn = new NodejsFunction(this, 'CartFunction', {
      ...commonFnProps,
      functionName: 'PointsMall-Cart',
      entry: path.join(backendSrcPath, 'cart/handler.ts'),
      handler: 'handler',
    } as NodejsFunctionProps);

    const orderFn = new NodejsFunction(this, 'OrderFunction', {
      ...commonFnProps,
      functionName: 'PointsMall-Order',
      entry: path.join(backendSrcPath, 'orders/handler.ts'),
      handler: 'handler',
    } as NodejsFunctionProps);

    const contentFn = new NodejsFunction(this, 'ContentFunction', {
      ...commonFnProps,
      functionName: 'PointsMall-Content',
      entry: path.join(backendSrcPath, 'content/handler.ts'),
      handler: 'handler',
      environment: {
        ...tableEnv,
        CONTENT_ITEMS_TABLE: contentItemsTable.tableName,
        CONTENT_CATEGORIES_TABLE: contentCategoriesTable.tableName,
        CONTENT_COMMENTS_TABLE: contentCommentsTable.tableName,
        CONTENT_LIKES_TABLE: contentLikesTable.tableName,
        CONTENT_RESERVATIONS_TABLE: contentReservationsTable.tableName,
        CONTENT_REWARD_POINTS: '10',
      },
    } as NodejsFunctionProps);
    this.contentFn = contentFn;

    // --- IAM Permissions ---

    usersTable.grantReadWriteData(authFn);
    authFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:SendEmail'],
      resources: ['*'],
    }));
    invitesTable.grantReadWriteData(authFn);
    productsTable.grantReadData(productFn);
    usersTable.grantReadWriteData(pointsFn);
    codesTable.grantReadWriteData(pointsFn);
    pointsRecordsTable.grantReadWriteData(pointsFn);
    claimsTable.grantReadWriteData(pointsFn);
    usersTable.grantReadWriteData(redemptionFn);
    productsTable.grantReadWriteData(redemptionFn);
    codesTable.grantReadWriteData(redemptionFn);
    redemptionsTable.grantReadWriteData(redemptionFn);
    pointsRecordsTable.grantReadWriteData(redemptionFn);
    addressesTable.grantReadData(redemptionFn);
    ordersTable.grantReadWriteData(redemptionFn);
    usersTable.grantReadWriteData(adminFn);
    productsTable.grantReadWriteData(adminFn);
    codesTable.grantReadWriteData(adminFn);
    invitesTable.grantReadWriteData(adminFn);
    claimsTable.grantReadWriteData(adminFn);
    pointsRecordsTable.grantReadWriteData(adminFn);
    contentItemsTable.grantReadWriteData(adminFn);
    contentCategoriesTable.grantReadWriteData(adminFn);
    contentCommentsTable.grantReadWriteData(adminFn);
    contentLikesTable.grantReadWriteData(adminFn);
    contentReservationsTable.grantReadWriteData(adminFn);

    // Cart Lambda: Cart, Addresses, Products tables
    cartTable.grantReadWriteData(cartFn);
    addressesTable.grantReadWriteData(cartFn);
    productsTable.grantReadWriteData(cartFn);

    // Order Lambda: Orders, Cart, Users, Products, PointsRecords, Addresses tables
    ordersTable.grantReadWriteData(orderFn);
    cartTable.grantReadWriteData(orderFn);
    usersTable.grantReadWriteData(orderFn);
    productsTable.grantReadWriteData(orderFn);
    pointsRecordsTable.grantReadWriteData(orderFn);
    addressesTable.grantReadData(orderFn);

    // Content Lambda: ContentItems, ContentCategories, ContentComments, ContentLikes, ContentReservations, Users, PointsRecords tables
    contentItemsTable.grantReadWriteData(contentFn);
    contentCategoriesTable.grantReadWriteData(contentFn);
    contentCommentsTable.grantReadWriteData(contentFn);
    contentLikesTable.grantReadWriteData(contentFn);
    contentReservationsTable.grantReadWriteData(contentFn);
    usersTable.grantReadWriteData(contentFn);
    pointsRecordsTable.grantReadWriteData(contentFn);

    // Grant all Lambdas permission to read the JWT secret from SSM
    const ssmReadPolicy = new iam.PolicyStatement({
      actions: ['ssm:GetParameter'],
      resources: [jwtSecretParam.parameterArn],
    });
    [authFn, productFn, pointsFn, redemptionFn, adminFn, cartFn, orderFn, contentFn].forEach(fn =>
      fn.addToRolePolicy(ssmReadPolicy)
    );

    // --- REST API Gateway ---

    this.api = new apigateway.RestApi(this, 'PointsMallApi', {
      restApiName: 'PointsMall-API',
      description: 'Points Mall REST API',
      deployOptions: { stageName: 'prod' },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    const api = this.api.root.addResource('api');

    // Auth routes
    const authInt = new apigateway.LambdaIntegration(authFn);
    const auth = api.addResource('auth');
    auth.addResource('register').addMethod('POST', authInt);
    auth.addResource('login').addMethod('POST', authInt);
    auth.addResource('verify-email').addMethod('GET', authInt);
    auth.addResource('refresh').addMethod('POST', authInt);
    auth.addResource('logout').addMethod('POST', authInt);
    const wechat = auth.addResource('wechat');
    wechat.addResource('qrcode').addMethod('POST', authInt);
    wechat.addResource('callback').addMethod('POST', authInt);
    auth.addResource('change-password').addMethod('POST', authInt);
    auth.addResource('forgot-password').addMethod('POST', authInt);
    auth.addResource('reset-password').addMethod('POST', authInt);
    auth.addResource('validate-invite').addMethod('POST', authInt);

    // Product routes
    const productInt = new apigateway.LambdaIntegration(productFn);
    const products = api.addResource('products');
    products.addMethod('GET', productInt);
    products.addResource('{id}').addMethod('GET', productInt);

    // Points routes
    const pointsInt = new apigateway.LambdaIntegration(pointsFn);
    const points = api.addResource('points');
    points.addResource('redeem-code').addMethod('POST', pointsInt);
    points.addResource('balance').addMethod('GET', pointsInt);
    points.addResource('records').addMethod('GET', pointsInt);

    // User routes (reuse Points Lambda — it already has Users table access)
    const user = api.addResource('user');
    user.addResource('profile').addMethod('GET', pointsInt);

    // Claims routes (user-facing, integrated to Points Lambda)
    const claims = api.addResource('claims');
    claims.addMethod('POST', pointsInt);
    claims.addMethod('GET', pointsInt);
    claims.addResource('upload-url').addMethod('POST', pointsInt);

    // Redemption routes
    const redemptionInt = new apigateway.LambdaIntegration(redemptionFn);
    const redemptions = api.addResource('redemptions');
    redemptions.addResource('points').addMethod('POST', redemptionInt);
    redemptions.addResource('code').addMethod('POST', redemptionInt);
    redemptions.addResource('history').addMethod('GET', redemptionInt);

    // Admin routes
    const adminInt = new apigateway.LambdaIntegration(adminFn);
    const admin = api.addResource('admin');
    const adminUsers = admin.addResource('users');
    adminUsers.addMethod('GET', adminInt);
    const adminUserById = adminUsers.addResource('{id}');
    adminUserById.addResource('roles').addMethod('PUT', adminInt);
    adminUserById.addResource('status').addMethod('PATCH', adminInt);
    adminUserById.addMethod('DELETE', adminInt);
    const adminCodes = admin.addResource('codes');
    adminCodes.addResource('batch-generate').addMethod('POST', adminInt);
    adminCodes.addResource('product-code').addMethod('POST', adminInt);
    adminCodes.addMethod('GET', adminInt);
    const adminCodeById = adminCodes.addResource('{id}');
    adminCodeById.addResource('disable').addMethod('PATCH', adminInt);
    adminCodeById.addMethod('DELETE', adminInt);
    const adminProducts = admin.addResource('products');
    adminProducts.addMethod('POST', adminInt);

    // Admin images upload-url (no productId needed — for product creation)
    const adminImages = admin.addResource('images');
    adminImages.addResource('upload-url').addMethod('POST', adminInt);

    const adminProductById = adminProducts.addResource('{id}');
    adminProductById.addMethod('PUT', adminInt);
    adminProductById.addResource('status').addMethod('PATCH', adminInt);
    adminProductById.addResource('upload-url').addMethod('POST', adminInt);
    adminProductById.addResource('images').addResource('{key}').addMethod('DELETE', adminInt);

    // Admin invite routes
    const adminInvites = admin.addResource('invites');
    adminInvites.addResource('batch').addMethod('POST', adminInt);
    adminInvites.addMethod('GET', adminInt);
    adminInvites.addResource('{token}').addResource('revoke').addMethod('PATCH', adminInt);

    // Admin claims routes
    const adminClaims = admin.addResource('claims');
    adminClaims.addMethod('GET', adminInt);
    adminClaims.addResource('{id}').addResource('review').addMethod('PATCH', adminInt);

    // Cart routes
    const cartInt = new apigateway.LambdaIntegration(cartFn);
    const cart = api.addResource('cart');
    cart.addMethod('GET', cartInt);
    const cartItems = cart.addResource('items');
    cartItems.addMethod('POST', cartInt);
    const cartItemById = cartItems.addResource('{productId}');
    cartItemById.addMethod('PUT', cartInt);
    cartItemById.addMethod('DELETE', cartInt);

    // Address routes
    const addresses = api.addResource('addresses');
    addresses.addMethod('GET', cartInt);
    addresses.addMethod('POST', cartInt);
    const addressById = addresses.addResource('{addressId}');
    addressById.addMethod('PUT', cartInt);
    addressById.addMethod('DELETE', cartInt);
    addressById.addResource('default').addMethod('PATCH', cartInt);

    // Order routes
    const orderInt = new apigateway.LambdaIntegration(orderFn);
    const orders = api.addResource('orders');
    orders.addMethod('POST', orderInt);
    orders.addResource('direct').addMethod('POST', orderInt);
    orders.addMethod('GET', orderInt);
    orders.addResource('{orderId}').addMethod('GET', orderInt);

    // Admin order routes
    const adminOrders = admin.addResource('orders');
    adminOrders.addMethod('GET', orderInt);
    adminOrders.addResource('stats').addMethod('GET', orderInt);
    const adminOrderById = adminOrders.addResource('{orderId}');
    adminOrderById.addMethod('GET', orderInt);
    adminOrderById.addResource('shipping').addMethod('PATCH', orderInt);

    // Content routes (user-facing)
    const contentInt = new apigateway.LambdaIntegration(contentFn);
    const content = api.addResource('content');
    content.addResource('upload-url').addMethod('POST', contentInt);
    content.addMethod('POST', contentInt);
    content.addMethod('GET', contentInt);
    content.addResource('categories').addMethod('GET', contentInt);
    const contentById = content.addResource('{id}');
    contentById.addMethod('GET', contentInt);
    contentById.addMethod('PUT', contentInt);
    const contentComments = contentById.addResource('comments');
    contentComments.addMethod('POST', contentInt);
    contentComments.addMethod('GET', contentInt);
    contentById.addResource('like').addMethod('POST', contentInt);
    contentById.addResource('reserve').addMethod('POST', contentInt);
    contentById.addResource('download').addMethod('GET', contentInt);

    // Admin content routes — use proxy to avoid Lambda resource policy size limit
    const adminContent = admin.addResource('content');
    adminContent.addMethod('GET', adminInt);
    adminContent.addProxy({
      defaultIntegration: adminInt,
      anyMethod: true,
    });

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: this.api.url,
      exportName: 'PointsMall-ApiUrl',
    });
  }

  /**
   * Configure the Admin and Points Lambdas with S3 permissions and environment variable
   * for the images bucket. Called after FrontendStack is created to avoid
   * circular dependencies between stacks.
   */
  public configureImagesBucket(imagesBucketName: string, imagesBucketArn: string): void {
    this.adminFn.addEnvironment('IMAGES_BUCKET', imagesBucketName);
    this.adminFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['s3:PutObject', 's3:DeleteObject', 's3:GetObject'],
      resources: [`${imagesBucketArn}/products/*`],
    }));
    // Admin Lambda: S3 delete permission for content files
    this.adminFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['s3:DeleteObject'],
      resources: [`${imagesBucketArn}/content/*`],
    }));
    // Points Lambda needs S3 access for claim image uploads
    this.pointsFn.addEnvironment('IMAGES_BUCKET', imagesBucketName);
    this.pointsFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['s3:PutObject'],
      resources: [`${imagesBucketArn}/claims/*`],
    }));
    // Content Lambda: S3 read/write/delete for content files
    this.contentFn.addEnvironment('IMAGES_BUCKET', imagesBucketName);
    this.contentFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['s3:PutObject', 's3:GetObject', 's3:DeleteObject'],
      resources: [`${imagesBucketArn}/content/*`],
    }));
  }
}
