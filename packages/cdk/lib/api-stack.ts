import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import { NodejsFunction, NodejsFunctionProps } from 'aws-cdk-lib/aws-lambda-nodejs';
import { DockerImageFunction, DockerImageCode, Runtime } from 'aws-cdk-lib/aws-lambda';
import * as ecr from 'aws-cdk-lib/aws-ecr';
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
  batchDistributionsTable: dynamodb.Table;
  travelApplicationsTable: dynamodb.Table;
  contentTagsTable: dynamodb.Table;
  awardTagsTable: dynamodb.Table;
  rewardTagsTable: dynamodb.Table;
  emailTemplatesTable: dynamodb.Table;
  ugsTable: dynamodb.Table;
  activitiesTable: dynamodb.Table;
  credentialsTable: dynamodb.Table;
  credentialSequencesTable: dynamodb.Table;
  activityTemplateAssociationsTable: dynamodb.Table;
  wishesTable: dynamodb.Table;
  wishVotesTable: dynamodb.Table;
  activitySkillClaimsTable: dynamodb.Table;
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
  private readonly conversionFn: DockerImageFunction;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const { usersTable, productsTable, codesTable, redemptionsTable, pointsRecordsTable, cartTable, addressesTable, ordersTable, invitesTable, claimsTable, contentItemsTable, contentCategoriesTable, contentCommentsTable, contentLikesTable, contentReservationsTable, batchDistributionsTable, travelApplicationsTable, contentTagsTable, awardTagsTable, rewardTagsTable, emailTemplatesTable, ugsTable, activitiesTable, credentialsTable, credentialSequencesTable, activityTemplateAssociationsTable, wishesTable, wishVotesTable, activitySkillClaimsTable } = props;

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
      WISHES_TABLE: wishesTable.tableName,
      WISH_VOTES_TABLE: wishVotesTable.tableName,
      ...(props.registerBaseUrl ? { REGISTER_BASE_URL: props.registerBaseUrl } : {}),
    };

    const backendSrcPath = path.join(__dirname, '../../backend/src');

    const commonFnProps: Partial<NodejsFunctionProps> = {
      runtime: Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
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
    adminFn.addEnvironment('BATCH_DISTRIBUTIONS_TABLE', batchDistributionsTable.tableName);
    adminFn.addEnvironment('TRAVEL_APPLICATIONS_TABLE', travelApplicationsTable.tableName);
    adminFn.addEnvironment('CONTENT_TAGS_TABLE', contentTagsTable.tableName);
    adminFn.addEnvironment('AWARD_TAGS_TABLE', awardTagsTable.tableName);
    adminFn.addEnvironment('REWARD_TAGS_TABLE', rewardTagsTable.tableName);
    adminFn.addEnvironment('UGS_TABLE', ugsTable.tableName);
    adminFn.addEnvironment('ACTIVITIES_TABLE', activitiesTable.tableName);
    adminFn.addEnvironment('ACTIVITY_SKILL_CLAIMS_TABLE', activitySkillClaimsTable.tableName);

    // Add travel table env var to Points Lambda
    pointsFn.addEnvironment('TRAVEL_APPLICATIONS_TABLE', travelApplicationsTable.tableName);

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
        CONTENT_TAGS_TABLE: contentTagsTable.tableName,
        ACTIVITIES_TABLE: activitiesTable.tableName,
        UGS_TABLE: ugsTable.tableName,
      },
    } as NodejsFunctionProps);
    this.contentFn = contentFn;

    // --- Digest Lambda (weekly digest email, triggered by EventBridge) ---
    const digestFn = new NodejsFunction(this, 'DigestFunction', {
      ...commonFnProps,
      functionName: 'PointsMall-Digest',
      entry: path.join(backendSrcPath, 'digest/handler.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(120),
      environment: {
        PRODUCTS_TABLE: productsTable.tableName,
        CONTENT_ITEMS_TABLE: contentItemsTable.tableName,
        USERS_TABLE: usersTable.tableName,
        EMAIL_TEMPLATES_TABLE: emailTemplatesTable.tableName,
        SENDER_EMAIL: props.senderEmail,
      },
    } as NodejsFunctionProps);

    // Digest Lambda: read-only access to Products, ContentItems, Users, EmailTemplates tables
    productsTable.grantReadData(digestFn);
    contentItemsTable.grantReadData(digestFn);
    usersTable.grantReadData(digestFn);
    emailTemplatesTable.grantReadData(digestFn);

    // Digest Lambda: SES permissions scoped to sender identity
    digestFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:SendEmail', 'ses:SendRawEmail'],
      resources: [
        `arn:aws:ses:${this.region}:${this.account}:identity/*`,
        `arn:aws:ses:${this.region}:${this.account}:configuration-set/*`,
      ],
    }));

    // EventBridge rule: trigger Digest Lambda every Sunday at UTC 00:00
    new events.Rule(this, 'DigestScheduleRule', {
      ruleName: 'PointsMall-DigestSchedule',
      description: 'Triggers Digest Lambda to send weekly digest emails every Sunday at UTC 00:00',
      schedule: events.Schedule.expression('cron(0 0 ? * SUN *)'),
      targets: [new targets.LambdaFunction(digestFn)],
    });

    // --- Leaderboard Lambda (read-only, decoupled from Admin/Points) ---
    const leaderboardFn = new NodejsFunction(this, 'LeaderboardFunction', {
      ...commonFnProps,
      functionName: 'PointsMall-Leaderboard',
      entry: path.join(backendSrcPath, 'leaderboard/handler.ts'),
      handler: 'handler',
      environment: {
        USERS_TABLE: usersTable.tableName,
        POINTS_RECORDS_TABLE: pointsRecordsTable.tableName,
        BATCH_DISTRIBUTIONS_TABLE: batchDistributionsTable.tableName,
        JWT_SECRET_PARAM: jwtSecretParam.parameterName,
      },
    } as NodejsFunctionProps);

    // Leaderboard Lambda: read-only access to Users, PointsRecords, BatchDistributions tables
    usersTable.grantReadData(leaderboardFn);
    pointsRecordsTable.grantReadData(leaderboardFn);
    batchDistributionsTable.grantReadData(leaderboardFn);

    // --- Sync Lambda (Feishu + Meetup activity data sync) ---
    const syncFn = new NodejsFunction(this, 'SyncFunction', {
      ...commonFnProps,
      functionName: 'PointsMall-Sync',
      entry: path.join(backendSrcPath, 'sync/handler.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(120),
      environment: {
        ACTIVITIES_TABLE: activitiesTable.tableName,
        USERS_TABLE: usersTable.tableName,
      },
    } as NodejsFunctionProps);

    // Sync Lambda: read/write Activities table, read Users table (for sync config)
    activitiesTable.grantReadWriteData(syncFn);
    usersTable.grantReadData(syncFn);

    // Admin Lambda: env var and permission to invoke Sync Lambda for manual sync
    adminFn.addEnvironment('SYNC_FUNCTION_NAME', syncFn.functionName);
    syncFn.grantInvoke(adminFn);

    // EventBridge rule: trigger Sync Lambda once per day by default
    new events.Rule(this, 'SyncScheduleRule', {
      ruleName: 'PointsMall-SyncSchedule',
      description: 'Triggers Sync Lambda to sync Feishu activity data',
      schedule: events.Schedule.rate(cdk.Duration.days(1)),
      targets: [new targets.LambdaFunction(syncFn)],
    });

    // --- Credential Lambda (independent module for community credentials) ---
    const credentialFn = new NodejsFunction(this, 'CredentialFunction', {
      ...commonFnProps,
      functionName: 'PointsMall-Credential',
      entry: path.join(backendSrcPath, 'credentials/handler.ts'),
      handler: 'handler',
      environment: {
        CREDENTIALS_TABLE: credentialsTable.tableName,
        CREDENTIAL_SEQUENCES_TABLE: credentialSequencesTable.tableName,
        USERS_TABLE: usersTable.tableName,
        ASSOCIATIONS_TABLE: activityTemplateAssociationsTable.tableName,
        POINTS_RECORDS_TABLE: pointsRecordsTable.tableName,
        ACTIVITIES_TABLE: activitiesTable.tableName,
        JWT_SECRET_PARAM: jwtSecretParam.parameterName,
        BASE_URL: 'https://creds.awscommunity.cn',
        CF_DISTRIBUTION_ID: 'E2B6NIC389CI8P',
      },
    } as NodejsFunctionProps);

    // Credential Lambda: read/write Credentials and CredentialSequences tables
    credentialsTable.grantReadWriteData(credentialFn);
    credentialSequencesTable.grantReadWriteData(credentialFn);

    // Credential Lambda: read/write ActivityTemplateAssociations table (association CRUD)
    activityTemplateAssociationsTable.grantReadWriteData(credentialFn);

    // Credential Lambda: read-only access to PointsRecords (eligibility) and Activities (association validation)
    pointsRecordsTable.grantReadData(credentialFn);
    activitiesTable.grantReadData(credentialFn);

    // Credential Lambda: read-only access to Users table (for auth verification)
    usersTable.grantReadData(credentialFn);

    // Credential Lambda: CloudFront invalidation permission for cache busting on revocation
    credentialFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['cloudfront:CreateInvalidation'],
      resources: [`arn:aws:cloudfront::778409058172:distribution/E2B6NIC389CI8P`],
    }));

    // --- Conversion Lambda (Docker-based, LibreOffice for Office-to-PDF conversion) ---
    const conversionRepo = ecr.Repository.fromRepositoryName(this, 'ConversionRepo',
      'cdk-hnb659fds-container-assets-778409058172-ap-northeast-1',
    );
    const conversionFn = new DockerImageFunction(this, 'ConversionFunction', {
      functionName: 'PointsMall-Conversion',
      code: DockerImageCode.fromEcr(conversionRepo, {
        tagOrDigest: 'conversion-v3',
      }),
      timeout: cdk.Duration.seconds(900),
      memorySize: 10240,
      ephemeralStorageSize: cdk.Size.mebibytes(2048),
      environment: {
        CONTENT_ITEMS_TABLE: contentItemsTable.tableName,
        HOME: '/tmp',
      },
    });
    this.conversionFn = conversionFn;

    // Conversion Lambda: DynamoDB read/write on ContentItems table (update previewFileKey and previewStatus)
    contentItemsTable.grantReadWriteData(conversionFn);

    // Conversion Lambda: permission to invoke itself for auto-retry on failure
    conversionFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['lambda:InvokeFunction'],
      resources: [`arn:aws:lambda:${this.region}:${this.account}:function:PointsMall-Conversion`],
    }));

    // Content Lambda: env var and permission to invoke Conversion Lambda for async PDF conversion
    contentFn.addEnvironment('CONVERSION_FUNCTION_NAME', conversionFn.functionName);
    conversionFn.grantInvoke(contentFn);

    // --- IAM Permissions ---

    usersTable.grantReadWriteData(authFn);
    authFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:SendEmail'],
      resources: ['*'],
    }));
    invitesTable.grantReadWriteData(authFn);
    productsTable.grantReadData(productFn);
    // Product Lambda: read Users table for getFeatureToggles (employee-store check)
    usersTable.grantReadData(productFn);
    usersTable.grantReadWriteData(pointsFn);
    codesTable.grantReadWriteData(pointsFn);
    pointsRecordsTable.grantReadWriteData(pointsFn);
    claimsTable.grantReadWriteData(pointsFn);
    travelApplicationsTable.grantReadWriteData(pointsFn);
    usersTable.grantReadWriteData(redemptionFn);
    productsTable.grantReadWriteData(redemptionFn);
    codesTable.grantReadWriteData(redemptionFn);
    redemptionsTable.grantReadWriteData(redemptionFn);
    pointsRecordsTable.grantReadWriteData(redemptionFn);
    addressesTable.grantReadData(redemptionFn);
    ordersTable.grantReadWriteData(redemptionFn);
    // Admin Lambda needs access to all PointsMall tables.
    // Using a wildcard resource policy to avoid IAM managed policy size limits (20480 bytes)
    // that would be exceeded if granting each table individually.
    adminFn.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'dynamodb:BatchGetItem',
        'dynamodb:BatchWriteItem',
        'dynamodb:ConditionCheckItem',
        'dynamodb:DeleteItem',
        'dynamodb:DescribeTable',
        'dynamodb:GetItem',
        'dynamodb:GetRecords',
        'dynamodb:GetShardIterator',
        'dynamodb:PutItem',
        'dynamodb:Query',
        'dynamodb:Scan',
        'dynamodb:UpdateItem',
      ],
      resources: [
        `arn:aws:dynamodb:${this.region}:${this.account}:table/PointsMall-*`,
        `arn:aws:dynamodb:${this.region}:${this.account}:table/PointsMall-*/index/*`,
      ],
    }));

    // Cart Lambda: Cart, Addresses, Products tables
    cartTable.grantReadWriteData(cartFn);
    addressesTable.grantReadWriteData(cartFn);
    productsTable.grantReadWriteData(cartFn);
    // Read Orders (incl. userId-createdAt-index GSI) for purchase-limit historical count
    ordersTable.grantReadData(cartFn);
    // Read Users table for getFeatureToggles (feature-toggles record stored under userId='feature-toggles')
    usersTable.grantReadData(cartFn);

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
    contentTagsTable.grantReadWriteData(contentFn);
    usersTable.grantReadWriteData(contentFn);
    pointsRecordsTable.grantReadWriteData(contentFn);
    activitiesTable.grantReadData(contentFn);
    ugsTable.grantReadData(contentFn);

    // SES permissions for email notifications (Admin, Points, Order, Content Lambdas)
    const sesEmailPolicy = new iam.PolicyStatement({
      actions: ['ses:SendEmail', 'ses:SendRawEmail'],
      resources: [
        `arn:aws:ses:${this.region}:${this.account}:identity/*`,
        `arn:aws:ses:${this.region}:${this.account}:configuration-set/*`,
      ],
    });
    [adminFn, pointsFn, orderFn, contentFn].forEach(fn => fn.addToRolePolicy(sesEmailPolicy));

    // EmailTemplates table: env var and permissions
    [adminFn, pointsFn, orderFn, contentFn].forEach(fn => {
      fn.addEnvironment('EMAIL_TEMPLATES_TABLE', emailTemplatesTable.tableName);
    });
    emailTemplatesTable.grantReadWriteData(adminFn);
    emailTemplatesTable.grantReadData(pointsFn);
    emailTemplatesTable.grantReadData(orderFn);
    emailTemplatesTable.grantReadData(contentFn);

    // --- Wishes Lambda (user-facing wish pool + admin review) ---
    const wishesFn = new NodejsFunction(this, 'WishesFunction', {
      ...commonFnProps,
      functionName: 'PointsMall-Wishes',
      entry: path.join(backendSrcPath, 'wishes/handler.ts'),
      handler: 'handler',
    } as NodejsFunctionProps);

    // Wishes Lambda: Wishes, WishVotes, Users, PointsRecords tables
    wishesTable.grantReadWriteData(wishesFn);
    wishVotesTable.grantReadWriteData(wishesFn);
    usersTable.grantReadWriteData(wishesFn);
    pointsRecordsTable.grantReadWriteData(wishesFn);

    // Wishes Lambda: SES permissions for email notifications
    wishesFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:SendEmail', 'ses:SendRawEmail'],
      resources: [
        `arn:aws:ses:${this.region}:${this.account}:identity/*`,
        `arn:aws:ses:${this.region}:${this.account}:configuration-set/*`,
      ],
    }));

    // Grant all Lambdas permission to read the JWT secret from SSM
    const ssmReadPolicy = new iam.PolicyStatement({
      actions: ['ssm:GetParameter'],
      resources: [jwtSecretParam.parameterArn],
    });
    [authFn, productFn, pointsFn, redemptionFn, adminFn, cartFn, orderFn, contentFn, leaderboardFn, credentialFn, wishesFn].forEach(fn =>
      fn.addToRolePolicy(ssmReadPolicy)
    );

    // --- REST API Gateway ---

    this.api = new apigateway.RestApi(this, 'PointsMallApi', {
      restApiName: 'PointsMall-API',
      description: 'Points Mall REST API',
      deployOptions: { stageName: 'prod' },
      binaryMediaTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
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
    const emailSubscriptions = user.addResource('email-subscriptions');
    emailSubscriptions.addMethod('GET', pointsInt);
    emailSubscriptions.addMethod('PUT', pointsInt);

    // Settings routes (public, no auth — integrated to Points Lambda)
    const settings = api.addResource('settings');
    settings.addResource('feature-toggles').addMethod('GET', pointsInt);
    settings.addResource('travel-sponsorship').addMethod('GET', pointsInt);
    settings.addResource('invite-settings').addMethod('GET', pointsInt);

    // Claims routes (user-facing, integrated to Points Lambda)
    const claims = api.addResource('claims');
    claims.addMethod('POST', pointsInt);
    claims.addMethod('GET', pointsInt);
    claims.addResource('upload-url').addMethod('POST', pointsInt);

    // Travel routes (user-facing, integrated to Points Lambda)
    const travel = api.addResource('travel');
    travel.addResource('quota').addMethod('GET', pointsInt);
    travel.addResource('apply').addMethod('POST', pointsInt);
    travel.addResource('my-applications').addMethod('GET', pointsInt);
    const travelApplications = travel.addResource('applications');
    travelApplications.addResource('{id}').addMethod('PUT', pointsInt);

    // Redemption routes
    const redemptionInt = new apigateway.LambdaIntegration(redemptionFn);
    const redemptions = api.addResource('redemptions');
    redemptions.addResource('points').addMethod('POST', redemptionInt);
    const redemptionCode = redemptions.addResource('code');
    redemptionCode.addMethod('POST', redemptionInt);
    // Multi-candidate lookup: returns candidate products for a code so the user can pick one.
    redemptionCode.addResource('lookup').addMethod('POST', redemptionInt);
    redemptions.addResource('history').addMethod('GET', redemptionInt);

    // Order Lambda integration — defined early because it's also used for admin order routes
    const orderInt = new apigateway.LambdaIntegration(orderFn);

    // Wishes Lambda integration — defined early because it's also used for admin wishes routes
    const wishesInt = new apigateway.LambdaIntegration(wishesFn);

    // Admin routes — use a single greedy proxy to avoid Lambda resource policy size limits.
    // Each explicit method registration adds a Lambda::Permission resource; with 30+ admin
    // routes the policy exceeds the 20 KB limit. A {proxy+} resource uses only 2 permissions
    // (ANY + OPTIONS) regardless of how many routes the handler supports internally.
    const adminInt = new apigateway.LambdaIntegration(adminFn);
    const admin = api.addResource('admin');

    // Admin order routes must be defined BEFORE addProxy to avoid CDK conflict with {proxy+}.
    // API Gateway prefers explicit paths over the greedy {proxy+} catch-all.
    const adminOrders = admin.addResource('orders');
    adminOrders.addMethod('GET', orderInt);
    adminOrders.addResource('stats').addMethod('GET', orderInt);
    adminOrders.addResource('export').addMethod('GET', orderInt);
    adminOrders.addResource('import').addMethod('POST', orderInt);
    const adminOrderById = adminOrders.addResource('{orderId}');
    adminOrderById.addMethod('GET', orderInt);
    adminOrderById.addResource('shipping').addMethod('PATCH', orderInt);
    adminOrderById.addResource('cancel').addMethod('POST', orderInt);

    // Admin credential routes must be defined BEFORE addProxy to avoid CDK conflict with {proxy+}.
    // These routes are handled by the independent Credential Lambda, not the Admin Lambda.
    // Collapsed to ANY + {proxy+}: the Credential Lambda does internal path-based routing
    // (see credentials/handler.ts, which matches event.path against CREDENTIAL_*_PATH /
    // CREDENTIAL_*_REGEX), so behavior is preserved while keeping the stack under the
    // CloudFormation 500-resource-per-stack limit. Each explicit method would otherwise add
    // a method + CORS OPTIONS method + 2 Lambda permissions.
    const credentialInt = new apigateway.LambdaIntegration(credentialFn);
    const adminCredentials = admin.addResource('credentials');
    adminCredentials.addMethod('ANY', credentialInt);
    adminCredentials.addProxy({ defaultIntegration: credentialInt, anyMethod: true });

    // Admin credential-association routes (SuperAdmin-only auth enforced inside the Lambda).
    // Also collapsed to ANY + {proxy+} for the same resource-count reason. The Lambda matches
    // ASSOCIATION_LIST_PATH and ASSOCIATION_DETAIL_REGEX internally.
    const adminCredentialAssociations = admin.addResource('credential-associations');
    adminCredentialAssociations.addMethod('ANY', credentialInt);
    adminCredentialAssociations.addProxy({ defaultIntegration: credentialInt, anyMethod: true });

    // Admin wishes routes must be defined BEFORE addProxy to avoid CDK conflict with {proxy+}.
    // These routes are handled by the independent Wishes Lambda, not the Admin Lambda.
    const adminWishes = admin.addResource('wishes');
    adminWishes.addMethod('GET', wishesInt);  // admin list wishes
    const adminWishById = adminWishes.addResource('{wishId}');
    const adminWishReview = adminWishById.addResource('review');
    adminWishReview.addMethod('PATCH', wishesInt);  // review wish
    const adminWishStatus = adminWishById.addResource('status');
    adminWishStatus.addMethod('PATCH', wishesInt);  // update wish status

    // Catch-all proxy for all other /api/admin/* routes (handled by adminFn)
    admin.addMethod('ANY', adminInt);
    admin.addProxy({
      defaultIntegration: adminInt,
      anyMethod: true,
    });

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

    // Order routes (user-facing)
    const orders = api.addResource('orders');
    orders.addMethod('POST', orderInt);
    orders.addResource('direct').addMethod('POST', orderInt);
    orders.addMethod('GET', orderInt);
    orders.addResource('{orderId}').addMethod('GET', orderInt);

    // Content routes (user-facing) — collapsed to ANY + {proxy+}.
    // The Content Lambda self-routes by event.path (see content/handler.ts: exact-path
    // matches for /api/content, /upload-url, /categories, /mine, /tags/search|hot|cloud,
    // /reservation-activities, plus CONTENT_ID_REGEX / CONTENT_*_REGEX for /{id} and
    // /{id}/comments|like|reserve|download). The Lambda does NOT read pathParameters, so
    // collapsing to a proxy preserves behavior exactly while keeping the stack under the
    // CloudFormation 500-resource-per-stack limit. Each explicit method would otherwise add
    // a method + CORS OPTIONS method + 2 Lambda permissions.
    const contentInt = new apigateway.LambdaIntegration(contentFn);
    const content = api.addResource('content');
    content.addMethod('ANY', contentInt);
    content.addProxy({ defaultIntegration: contentInt, anyMethod: true });

    // Leaderboard routes
    const leaderboardInt = new apigateway.LambdaIntegration(leaderboardFn);
    const leaderboard = api.addResource('leaderboard');
    leaderboard.addResource('ranking').addMethod('GET', leaderboardInt);
    leaderboard.addResource('announcements').addMethod('GET', leaderboardInt);

    // Wishes routes (user-facing)
    const wishes = api.addResource('wishes');
    wishes.addMethod('POST', wishesInt);   // create wish
    wishes.addMethod('GET', wishesInt);    // list wishes
    const wishesMine = wishes.addResource('mine');
    wishesMine.addMethod('GET', wishesInt);  // my wishes
    wishesMine.addResource('monthly-count').addMethod('GET', wishesInt);  // monthly wish count
    const wishById = wishes.addResource('{wishId}');
    wishById.addMethod('PUT', wishesInt);    // edit wish
    wishById.addMethod('DELETE', wishesInt);  // delete wish
    wishById.addResource('vote').addMethod('POST', wishesInt);  // vote

    // Credential user-facing routes (authenticated; handled by Credential Lambda).
    // Distinct from /api/admin/credentials/* — these live under the /api root for
    // certificate self-application. Auth/userId scoping is enforced inside the Lambda.
    // Collapsed to ANY + {proxy+}: the Lambda routes /api/credentials/* internally
    // (USER_CREDENTIALS_PREFIX), keeping the stack under the 500-resource CFN limit.
    const credentials = api.addResource('credentials');
    credentials.addMethod('ANY', credentialInt);
    credentials.addProxy({ defaultIntegration: credentialInt, anyMethod: true });

    // Public credential page route: /c/{credentialId} (no auth required)
    // This is at the API root level, not under /api
    const c = this.api.root.addResource('c');
    c.addResource('{credentialId}').addMethod('GET', credentialInt);

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
  public configureImagesBucket(imagesBucketName: string, imagesBucketArn: string, uploadViaCloudfront: string, uploadTokenSecret: string): void {
    // Add upload proxy environment variables to Lambda functions that generate upload URLs
    this.adminFn.addEnvironment('UPLOAD_VIA_CLOUDFRONT', uploadViaCloudfront);
    this.adminFn.addEnvironment('UPLOAD_TOKEN_SECRET', uploadTokenSecret);
    this.contentFn.addEnvironment('UPLOAD_VIA_CLOUDFRONT', uploadViaCloudfront);
    this.contentFn.addEnvironment('UPLOAD_TOKEN_SECRET', uploadTokenSecret);
    this.pointsFn.addEnvironment('UPLOAD_VIA_CLOUDFRONT', uploadViaCloudfront);
    this.pointsFn.addEnvironment('UPLOAD_TOKEN_SECRET', uploadTokenSecret);

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
    // Admin Lambda: S3 permissions for report exports (upload + presigned download)
    this.adminFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['s3:PutObject', 's3:GetObject'],
      resources: [`${imagesBucketArn}/exports/*`],
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

    // Conversion Lambda: S3 read/write/delete for content files (download originals, upload preview PDFs, delete old previews)
    this.conversionFn.addEnvironment('IMAGES_BUCKET', imagesBucketName);
    this.conversionFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
      resources: [`${imagesBucketArn}/content/*`],
    }));
  }
}
