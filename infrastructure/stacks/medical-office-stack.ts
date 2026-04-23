import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as apigatewayv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as apigatewayv2Integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as sns from "aws-cdk-lib/aws-sns";
import * as ses from "aws-cdk-lib/aws-ses";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as cloudfrontOrigins from "aws-cdk-lib/aws-cloudfront-origins";
import * as s3Deployment from "aws-cdk-lib/aws-s3-deployment";
import * as lambdaEventSources from "aws-cdk-lib/aws-lambda-event-sources";
import * as logs from "aws-cdk-lib/aws-logs";
import * as path from "path";

interface Props extends cdk.StackProps {
  fromEmail: string;    // e.g. "alerts@yourpractice.com"
  environment: "dev" | "prod";
}

export class MedicalOfficeStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props);

    const isProd = props.environment === "prod";

    // ── DynamoDB ─────────────────────────────────────────────────────────────
    const tasksTable = new dynamodb.Table(this, "TasksTable", {
      tableName: `medical-office-tasks-${props.environment}`,
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,   // HIPAA: encryption at rest
      pointInTimeRecovery: true,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,  // for notifications Lambda
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // GSI1: query by status
    tasksTable.addGlobalSecondaryIndex({
      indexName: "GSI1",
      partitionKey: { name: "GSI1PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "GSI1SK", type: dynamodb.AttributeType.STRING },
    });

    // GSI2: query by assigned staff member
    tasksTable.addGlobalSecondaryIndex({
      indexName: "GSI2",
      partitionKey: { name: "GSI2PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "GSI2SK", type: dynamodb.AttributeType.STRING },
    });

    // ── Cognito ───────────────────────────────────────────────────────────────
    const userPool = new cognito.UserPool(this, "UserPool", {
      userPoolName: `medical-office-users-${props.environment}`,
      selfSignUpEnabled: false,          // admin-only signup for medical staff
      signInAliases: { email: true },
      mfa: isProd ? cognito.Mfa.REQUIRED : cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { sms: true, otp: true },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // Groups: front-desk, clinical, admin
    new cognito.CfnUserPoolGroup(this, "FrontDeskGroup", {
      userPoolId: userPool.userPoolId,
      groupName: "front-desk",
    });
    new cognito.CfnUserPoolGroup(this, "ClinicalGroup", {
      userPoolId: userPool.userPoolId,
      groupName: "clinical",
    });
    new cognito.CfnUserPoolGroup(this, "AdminGroup", {
      userPoolId: userPool.userPoolId,
      groupName: "admin",
    });

    const userPoolClient = userPool.addClient("WebClient", {
      authFlows: {
        userSrp: true,
        userPassword: false,   // disable password auth in prod
      },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.EMAIL, cognito.OAuthScope.OPENID, cognito.OAuthScope.PROFILE],
      },
    });

    // ── SNS alert topic ───────────────────────────────────────────────────────
    const alertTopic = new sns.Topic(this, "AlertTopic", {
      topicName: `medical-office-alerts-${props.environment}`,
    });

    // ── Lambda: Tasks API ─────────────────────────────────────────────────────
    const tasksLambda = new lambdaNodejs.NodejsFunction(this, "TasksHandler", {
      functionName: `medical-office-tasks-${props.environment}`,
      entry: path.join(__dirname, "../../backend/lambdas/tasks/handler.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(15),
      memorySize: 256,
      environment: {
        TASKS_TABLE: tasksTable.tableName,
      },
      logRetention: isProd ? logs.RetentionDays.ONE_YEAR : logs.RetentionDays.ONE_WEEK,
    });

    tasksTable.grantReadWriteData(tasksLambda);

    // ── Lambda: Notifications ─────────────────────────────────────────────────
    const notificationsLambda = new lambdaNodejs.NodejsFunction(this, "NotificationsHandler", {
      functionName: `medical-office-notifications-${props.environment}`,
      entry: path.join(__dirname, "../../backend/lambdas/notifications/handler.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 128,
      environment: {
        FROM_EMAIL: props.fromEmail,
        ALERT_TOPIC_ARN: alertTopic.topicArn,
      },
    });

    alertTopic.grantPublish(notificationsLambda);
    notificationsLambda.addToRolePolicy(new cdk.aws_iam.PolicyStatement({
      actions: ["ses:SendEmail", "ses:SendRawEmail"],
      resources: ["*"],
    }));

    // Wire DynamoDB Streams → Notifications Lambda
    notificationsLambda.addEventSource(new lambdaEventSources.DynamoEventSource(tasksTable, {
      startingPosition: lambda.StartingPosition.TRIM_HORIZON,
      batchSize: 10,
      retryAttempts: 3,
    }));

    // ── API Gateway (HTTP API) ─────────────────────────────────────────────────
    const httpApi = new apigatewayv2.HttpApi(this, "TasksApi", {
      apiName: `medical-office-api-${props.environment}`,
      corsPreflight: {
        allowOrigins: ["*"],           // tighten to your CloudFront domain in prod
        allowMethods: [
          apigatewayv2.CorsHttpMethod.GET,
          apigatewayv2.CorsHttpMethod.POST,
          apigatewayv2.CorsHttpMethod.PATCH,
          apigatewayv2.CorsHttpMethod.DELETE,
        ],
        allowHeaders: ["Authorization", "Content-Type"],
      },
    });

    const tasksIntegration = new apigatewayv2Integrations.HttpLambdaIntegration(
      "TasksIntegration",
      tasksLambda
    );

    httpApi.addRoutes({ path: "/tasks", methods: [apigatewayv2.HttpMethod.GET, apigatewayv2.HttpMethod.POST], integration: tasksIntegration });
    httpApi.addRoutes({ path: "/tasks/{taskId}", methods: [apigatewayv2.HttpMethod.GET, apigatewayv2.HttpMethod.PATCH, apigatewayv2.HttpMethod.DELETE], integration: tasksIntegration });

    // ── S3 + CloudFront for frontend ─────────────────────────────────────────
    const siteBucket = new s3.Bucket(this, "SiteBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,   // HIPAA: no public S3
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: !isProd,
    });

    const distribution = new cloudfront.Distribution(this, "Distribution", {
      defaultBehavior: {
        origin: cloudfrontOrigins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      defaultRootObject: "index.html",
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: "/index.html" },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: "/index.html" },
      ],
    });

    // ── Outputs ───────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, "ApiUrl", { value: httpApi.apiEndpoint });
    new cdk.CfnOutput(this, "UserPoolId", { value: userPool.userPoolId });
    new cdk.CfnOutput(this, "UserPoolClientId", { value: userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, "CloudFrontUrl", { value: `https://${distribution.distributionDomainName}` });
    new cdk.CfnOutput(this, "TableName", { value: tasksTable.tableName });
  }
}
