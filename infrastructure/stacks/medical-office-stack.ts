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
    const appUrl = 'https://d3ivikhwu2678t.cloudfront.net'

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

    // ── Cognito ───────────────────────────────────────────────────────────────
    const userPool = cognito.UserPool.fromUserPoolId(this, 'UserPool', 'us-east-1_rUUpPPAqG')

    const userPoolClient = cognito.UserPoolClient.fromUserPoolClientId(
      this, 'UserPoolClient', '3cja6d55tltoap89q3tr5unqgb'
    )

    // ── Lambda env vars ───────────────────────────────────────────────────────
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

    // EventBridge: run overdue check every day at 8am ET
    new events.Rule(this, 'OverdueSchedule', {
      ruleName: `medical-office-overdue-${props.environment}`,
      schedule: events.Schedule.cron({ minute: '0', hour: '13' }), // 8am ET = 13:00 UTC
      targets: [new eventsTargets.LambdaFunction(overdueLambda)],
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

    // Task routes
    httpApi.addRoutes({ path: '/tasks', methods: [apigatewayv2.HttpMethod.GET, apigatewayv2.HttpMethod.POST], integration: tasksIntegration })
    httpApi.addRoutes({ path: '/tasks/{taskId}', methods: [apigatewayv2.HttpMethod.GET, apigatewayv2.HttpMethod.PATCH, apigatewayv2.HttpMethod.DELETE], integration: tasksIntegration })
    httpApi.addRoutes({ path: '/tasks/{taskId}/activity', methods: [apigatewayv2.HttpMethod.POST], integration: tasksIntegration })

    // Prefs routes
    httpApi.addRoutes({ path: '/prefs', methods: [apigatewayv2.HttpMethod.GET], integration: prefsIntegration })
    httpApi.addRoutes({ path: '/prefs/{userId}', methods: [apigatewayv2.HttpMethod.GET, apigatewayv2.HttpMethod.PUT], integration: prefsIntegration })

    // ── S3 + CloudFront ───────────────────────────────────────────────────────
    const siteBucket = s3.Bucket.fromBucketName(this, 'SiteBucket', 'medicalofficestack-sitebucket397a1860-axlnzizli2yd')

const distribution = new cloudfront.Distribution(this, 'SiteDistribution', {
  defaultBehavior: {
    origin: new cloudfrontOrigins.S3StaticWebsiteOrigin(siteBucket),
    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
  },
  defaultRootObject: 'index.html',
  errorResponses: [
    { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html' },
    { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html' },
  ],
})

new cdk.CfnOutput(this, 'CloudFrontDistributionId', { value: distribution.distributionId })
new cdk.CfnOutput(this, 'CloudFrontUrl', { value: `https://${distribution.distributionDomainName}` })

    // ── SES Email Identity ────────────────────────────────────────────────────
    // Note: verify manually via AWS console or CLI before first deploy
    // aws sesv2 create-email-identity --email-identity your@email.com

    // ── Outputs ───────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'ApiUrl', { value: httpApi.apiEndpoint })
    new cdk.CfnOutput(this, 'TasksTableName', { value: tasksTable.tableName })
    new cdk.CfnOutput(this, 'PrefsTableName', { value: prefsTable.tableName })
    new cdk.CfnOutput(this, 'UserPoolId', { value: 'us-east-1_rUUpPPAqG' })
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: '3cja6d55tltoap89q3tr5unqgb' })
    new cdk.CfnOutput(this, 'CloudFrontUrl', { value: appUrl })
  }
}
