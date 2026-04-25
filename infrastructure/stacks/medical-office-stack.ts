import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs'
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources'
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2'
import * as apigatewayv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations'
import * as cognito from 'aws-cdk-lib/aws-cognito'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as cloudfrontOrigins from 'aws-cdk-lib/aws-cloudfront-origins'
import * as events from 'aws-cdk-lib/aws-events'
import * as eventsTargets from 'aws-cdk-lib/aws-events-targets'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as path from 'path'

interface Props extends cdk.StackProps {
  fromEmail: string
  environment: 'dev' | 'prod'
}

export class MedicalOfficeStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props)

    const isProd = props.environment === 'prod'
    const appUrl = 'https://d15iv99epopcg7.cloudfront.net'
    const apiUrl = 'https://op3fubg07j.execute-api.us-east-1.amazonaws.com'

    // ── DynamoDB: Tasks ───────────────────────────────────────────────────────
    const tasksTable = new dynamodb.Table(this, 'TasksTable', {
      tableName: `medical-office-tasks-${props.environment}`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: true,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    })

    tasksTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
    })

    tasksTable.addGlobalSecondaryIndex({
      indexName: 'GSI2',
      partitionKey: { name: 'GSI2PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI2SK', type: dynamodb.AttributeType.STRING },
    })

    // ── DynamoDB: Notification Prefs ──────────────────────────────────────────
    const prefsTable = new dynamodb.Table(this, 'PrefsTable', {
      tableName: `medical-office-prefs-${props.environment}`,
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    })

    // ── DynamoDB: ECW OAuth Tokens ────────────────────────────────────────────
    const tokensTable = new dynamodb.Table(this, 'TokensTable', {
      tableName: `medical-office-ecw-tokens-${props.environment}`,
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    })

    // ── Cognito ───────────────────────────────────────────────────────────────
    const userPool = cognito.UserPool.fromUserPoolId(this, 'UserPool', 'us-east-1_rUUpPPAqG')
    const userPoolClient = cognito.UserPoolClient.fromUserPoolClientId(
      this, 'UserPoolClient', '2ecmdgbgkmjd0q3cj1m12o78ts'
    )

    // ── Lambda defaults ───────────────────────────────────────────────────────
    const commonEnv = {
      TASKS_TABLE: tasksTable.tableName,
      PREFS_TABLE: prefsTable.tableName,
      FROM_EMAIL: props.fromEmail,
      APP_URL: appUrl,
      USER_POOL_ID: 'us-east-1_rUUpPPAqG',
    }

    const lambdaDefaults = {
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      logRetention: isProd ? logs.RetentionDays.ONE_YEAR : logs.RetentionDays.ONE_WEEK,
    }

    // ── Lambda: Tasks ─────────────────────────────────────────────────────────
    const tasksLambda = new lambdaNodejs.NodejsFunction(this, 'TasksHandler', {
      functionName: `medical-office-tasks-${props.environment}`,
      entry: path.join(__dirname, '../../backend/lambdas/tasks/handler.ts'),
      handler: 'handler',
      environment: commonEnv,
      ...lambdaDefaults,
    })
    tasksTable.grantReadWriteData(tasksLambda)

    // ── Lambda: Notification Prefs ────────────────────────────────────────────
    const prefsLambda = new lambdaNodejs.NodejsFunction(this, 'PrefsHandler', {
      functionName: `medical-office-prefs-${props.environment}`,
      entry: path.join(__dirname, '../../backend/lambdas/prefs/handler.ts'),
      handler: 'handler',
      environment: commonEnv,
      ...lambdaDefaults,
    })
    prefsTable.grantReadWriteData(prefsLambda)
    prefsLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['cognito-idp:ListUsers'],
      resources: [`arn:aws:cognito-idp:us-east-1:218908192454:userpool/us-east-1_rUUpPPAqG`],
    }))

    // ── Lambda: Notifications (DynamoDB Stream) ───────────────────────────────
    const notificationsLambda = new lambdaNodejs.NodejsFunction(this, 'NotificationsHandler', {
      functionName: `medical-office-notifications-${props.environment}`,
      entry: path.join(__dirname, '../../backend/lambdas/notifications/handler.ts'),
      handler: 'handler',
      environment: commonEnv,
      ...lambdaDefaults,
    })
    prefsTable.grantReadData(notificationsLambda)
    notificationsLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:SendEmail', 'ses:SendRawEmail', 'sns:Publish'],
      resources: ['*'],
    }))
    notificationsLambda.addEventSource(new lambdaEventSources.DynamoEventSource(tasksTable, {
      startingPosition: lambda.StartingPosition.LATEST,
      batchSize: 10,
      retryAttempts: 3,
    }))

    // ── Lambda: Overdue (Daily scheduler) ────────────────────────────────────
    const overdueLambda = new lambdaNodejs.NodejsFunction(this, 'OverdueHandler', {
      functionName: `medical-office-overdue-${props.environment}`,
      entry: path.join(__dirname, '../../backend/lambdas/overdue/handler.ts'),
      handler: 'handler',
      environment: commonEnv,
      ...lambdaDefaults,
    })
    tasksTable.grantReadData(overdueLambda)
    prefsTable.grantReadData(overdueLambda)
    overdueLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:SendEmail', 'ses:SendRawEmail', 'sns:Publish'],
      resources: ['*'],
    }))

    new events.Rule(this, 'OverdueSchedule', {
      ruleName: `medical-office-overdue-${props.environment}`,
      schedule: events.Schedule.cron({ minute: '0', hour: '13' }),
      targets: [new eventsTargets.LambdaFunction(overdueLambda)],
    })

    // ── Lambda: FHIR Auth ─────────────────────────────────────────────────────
    const fhirAuthLambda = new lambdaNodejs.NodejsFunction(this, 'FhirAuthHandler', {
      functionName: `medical-office-fhir-auth-${props.environment}`,
      entry: path.join(__dirname, '../../backend/lambdas/fhir-auth/handler.ts'),
      handler: 'handler',
      environment: {
        TOKENS_TABLE: tokensTable.tableName,
        ECW_SECRET_ID: 'medtask/ecw-sandbox',
        API_URL: apiUrl,
        APP_URL: appUrl,
      },
      ...lambdaDefaults,
    })
    tokensTable.grantReadWriteData(fhirAuthLambda)
    fhirAuthLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['secretsmanager:GetSecretValue'],
      resources: [`arn:aws:secretsmanager:us-east-1:218908192454:secret:medtask/ecw-sandbox*`],
    }))

    // ── Lambda: FHIR Search ───────────────────────────────────────────────────
    const fhirSearchLambda = new lambdaNodejs.NodejsFunction(this, 'FhirSearchHandler', {
      functionName: `medical-office-fhir-search-${props.environment}`,
      entry: path.join(__dirname, '../../backend/lambdas/fhir-search/handler.ts'),
      handler: 'handler',
      environment: {
        TOKENS_TABLE: tokensTable.tableName,
        ECW_SECRET_ID: 'medtask/ecw-sandbox',
        API_URL: apiUrl,
        APP_URL: appUrl,
      },
      ...lambdaDefaults,
    })
    tokensTable.grantReadWriteData(fhirSearchLambda)
    fhirSearchLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['secretsmanager:GetSecretValue'],
      resources: [`arn:aws:secretsmanager:us-east-1:218908192454:secret:medtask/ecw-sandbox*`],
    }))

    // ── Lambda: Report Generator ─────────────────────────────────────────────
    const reportLambda = new lambdaNodejs.NodejsFunction(this, 'ReportHandler', {
      functionName: `medical-office-report-${props.environment}`,
      entry: path.join(__dirname, '../../backend/lambdas/report/handler.ts'),
      handler: 'handler',
      environment: {
        TASKS_TABLE: tasksTable.tableName,
        PREFS_TABLE: prefsTable.tableName,
        FROM_EMAIL: props.fromEmail,
        APP_URL: appUrl,
      },
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(120),
      memorySize: 512,
      logRetention: isProd ? logs.RetentionDays.ONE_YEAR : logs.RetentionDays.ONE_WEEK,
      bundling: {
        externalModules: ['@aws-sdk/*', 'exceljs', 'pdfkit'],
        commandHooks: {
          beforeBundling(_inputDir: string, _outputDir: string): string[] { return [] },
          afterBundling(_inputDir: string, outputDir: string): string[] {
            return [
              `cd ${outputDir} && npm init -y && npm install --production exceljs@4.4.0 pdfkit@0.15.0`,
            ]
          },
          beforeInstall(_inputDir: string, _outputDir: string): string[] { return [] },
        },
      },
    })
    tasksTable.grantReadData(reportLambda)
    prefsTable.grantReadData(reportLambda)
    reportLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:SendEmail', 'ses:SendRawEmail'],
      resources: ['*'],
    }))

    // Scheduled daily report Lambda
    const scheduledReportLambda = new lambdaNodejs.NodejsFunction(this, 'ScheduledReportHandler', {
      functionName: `medical-office-scheduled-report-${props.environment}`,
      entry: path.join(__dirname, '../../backend/lambdas/report/handler.ts'),
      handler: 'scheduledHandler',
      environment: {
        TASKS_TABLE: tasksTable.tableName,
        PREFS_TABLE: prefsTable.tableName,
        FROM_EMAIL: props.fromEmail,
        APP_URL: appUrl,
      },
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(120),
      memorySize: 512,
      logRetention: isProd ? logs.RetentionDays.ONE_YEAR : logs.RetentionDays.ONE_WEEK,
      bundling: {
        externalModules: ['@aws-sdk/*', 'exceljs', 'pdfkit'],
        commandHooks: {
          beforeBundling(_inputDir: string, _outputDir: string): string[] { return [] },
          afterBundling(_inputDir: string, outputDir: string): string[] {
            return [
              `cd ${outputDir} && npm init -y && npm install --production exceljs@4.4.0 pdfkit@0.15.0`,
            ]
          },
          beforeInstall(_inputDir: string, _outputDir: string): string[] { return [] },
        },
      },
    })
    tasksTable.grantReadData(scheduledReportLambda)
    prefsTable.grantReadData(scheduledReportLambda)
    scheduledReportLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:SendEmail', 'ses:SendRawEmail'],
      resources: ['*'],
    }))

    // EventBridge: daily report at 7am ET (12:00 UTC)
    new events.Rule(this, 'DailyReportSchedule', {
      ruleName: `medical-office-daily-report-${props.environment}`,
      schedule: events.Schedule.cron({ minute: '0', hour: '12' }),
      targets: [new eventsTargets.LambdaFunction(scheduledReportLambda)],
    })

    // ── API Gateway ───────────────────────────────────────────────────────────
    const httpApi = new apigatewayv2.HttpApi(this, 'TasksApi', {
      apiName: `medical-office-api-${props.environment}`,
      corsPreflight: {
        allowOrigins: [appUrl, 'http://localhost:3000'],
        allowMethods: [
          apigatewayv2.CorsHttpMethod.GET,
          apigatewayv2.CorsHttpMethod.POST,
          apigatewayv2.CorsHttpMethod.PATCH,
          apigatewayv2.CorsHttpMethod.PUT,
          apigatewayv2.CorsHttpMethod.DELETE,
          apigatewayv2.CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: ['Authorization', 'Content-Type'],
        maxAge: cdk.Duration.days(1),
      },
    })

    const tasksIntegration = new apigatewayv2Integrations.HttpLambdaIntegration('TasksIntegration', tasksLambda)
    const prefsIntegration = new apigatewayv2Integrations.HttpLambdaIntegration('PrefsIntegration', prefsLambda)
    const fhirAuthIntegration = new apigatewayv2Integrations.HttpLambdaIntegration('FhirAuthIntegration', fhirAuthLambda)
    const fhirSearchIntegration = new apigatewayv2Integrations.HttpLambdaIntegration('FhirSearchIntegration', fhirSearchLambda)

    // Task routes
    httpApi.addRoutes({ path: '/tasks', methods: [apigatewayv2.HttpMethod.GET, apigatewayv2.HttpMethod.POST], integration: tasksIntegration })
    httpApi.addRoutes({ path: '/tasks/{taskId}', methods: [apigatewayv2.HttpMethod.GET, apigatewayv2.HttpMethod.PATCH, apigatewayv2.HttpMethod.DELETE], integration: tasksIntegration })
    httpApi.addRoutes({ path: '/tasks/{taskId}/activity', methods: [apigatewayv2.HttpMethod.POST], integration: tasksIntegration })

    // Config routes
    httpApi.addRoutes({ path: '/config/task-types', methods: [apigatewayv2.HttpMethod.GET, apigatewayv2.HttpMethod.PUT], integration: tasksIntegration })

    // Prefs routes
    httpApi.addRoutes({ path: '/prefs', methods: [apigatewayv2.HttpMethod.GET], integration: prefsIntegration })
    httpApi.addRoutes({ path: '/prefs/{userId}', methods: [apigatewayv2.HttpMethod.GET, apigatewayv2.HttpMethod.PUT], integration: prefsIntegration })

    // FHIR auth routes
    httpApi.addRoutes({ path: '/fhir/auth', methods: [apigatewayv2.HttpMethod.GET], integration: fhirAuthIntegration })
    httpApi.addRoutes({ path: '/fhir/callback', methods: [apigatewayv2.HttpMethod.GET], integration: fhirAuthIntegration })
    httpApi.addRoutes({ path: '/fhir/status', methods: [apigatewayv2.HttpMethod.GET], integration: fhirAuthIntegration })
    httpApi.addRoutes({ path: '/fhir/refresh', methods: [apigatewayv2.HttpMethod.POST], integration: fhirAuthIntegration })

    // FHIR search routes
    httpApi.addRoutes({ path: '/fhir/search', methods: [apigatewayv2.HttpMethod.GET], integration: fhirSearchIntegration })
    httpApi.addRoutes({ path: '/fhir/patient/{patientId}', methods: [apigatewayv2.HttpMethod.GET], integration: fhirSearchIntegration })

    // Report routes
    const reportIntegration = new apigatewayv2Integrations.HttpLambdaIntegration('ReportIntegration', reportLambda)
    httpApi.addRoutes({ path: '/reports/generate', methods: [apigatewayv2.HttpMethod.POST, apigatewayv2.HttpMethod.OPTIONS], integration: reportIntegration })

    // ── S3 + CloudFront ───────────────────────────────────────────────────────
    const siteBucket = s3.Bucket.fromBucketName(
      this, 'SiteBucket',
      'medicalofficestack-sitebucket397a1860-axlnzizli2yd'
    )

    const distribution = new cloudfront.Distribution(this, 'SiteDistribution', {
      defaultBehavior: {
        origin: cloudfrontOrigins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html' },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html' },
      ],
    })

    // ── Outputs ───────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'ApiUrl', { value: httpApi.apiEndpoint })
    new cdk.CfnOutput(this, 'TasksTableName', { value: tasksTable.tableName })
    new cdk.CfnOutput(this, 'PrefsTableName', { value: prefsTable.tableName })
    new cdk.CfnOutput(this, 'TokensTableName', { value: tokensTable.tableName })
    new cdk.CfnOutput(this, 'UserPoolId', { value: 'us-east-1_rUUpPPAqG' })
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: '2ecmdgbgkmjd0q3cj1m12o78ts' })
    new cdk.CfnOutput(this, 'CloudFrontUrl', { value: `https://${distribution.distributionDomainName}` })
    new cdk.CfnOutput(this, 'CloudFrontDistributionId', { value: distribution.distributionId })
  }
}
