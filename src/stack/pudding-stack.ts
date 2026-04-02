import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import * as path from 'path';
import { SSM_PATHS } from '../lib/types';

interface PuddingStackProps extends cdk.StackProps {
  alertEmail: string;
}

export class PuddingStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: PuddingStackProps) {
    super(scope, id, props);

    // --- SNS Topic for alerts ---
    const alertTopic = new sns.Topic(this, 'AlertTopic', {
      topicName: 'pudding-alerts',
      displayName: 'Pudding Cookie Refresh Alerts',
    });

    alertTopic.addSubscription(
      new snsSubscriptions.EmailSubscription(props.alertEmail)
    );

    // --- Audio Bucket ---
    const audioBucket = new s3.Bucket(this, 'AudioBucket', {
      bucketName: `pudding-audio-${this.account}`,
      blockPublicAccess: new s3.BlockPublicAccess({
        blockPublicAcls: false,
        ignorePublicAcls: false,
        blockPublicPolicy: false,
        restrictPublicBuckets: false,
      }),
      cors: [{
        allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET],
        allowedOrigins: ['https://c4i0apps.com'],
        allowedHeaders: ['*'],
      }],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    audioBucket.addToResourcePolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject'],
      resources: [audioBucket.arnForObjects('audio/*')],
      principals: [new iam.AnyPrincipal()],
    }));

    // --- SSM parameter ARNs (created by scripts/setup.ts, referenced here for IAM) ---
    const ssmCookieArn = `arn:aws:ssm:${this.region}:${this.account}:parameter${SSM_PATHS.cookieData}`;
    const ssmDeviceArn = `arn:aws:ssm:${this.region}:${this.account}:parameter${SSM_PATHS.deviceSerial}`;

    // --- Announcement Lambda ---
    const announcementFn = new nodejs.NodejsFunction(this, 'AnnouncementFn', {
      functionName: 'pudding-announcement',
      entry: path.join(__dirname, '..', 'lambda', 'announcement.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      architecture: lambda.Architecture.ARM_64,
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node20',
        // alexa-remote2 reads its own package.json at runtime for version info,
        // so keep it (and alexa-cookie2) as installed node_modules
      },
    });

    // IAM: read SSM params
    announcementFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter'],
        resources: [ssmCookieArn, ssmDeviceArn],
      })
    );

    // --- Cookie Refresh Lambda ---
    const cookieRefreshFn = new nodejs.NodejsFunction(this, 'CookieRefreshFn', {
      functionName: 'pudding-cookie-refresh',
      entry: path.join(__dirname, '..', 'lambda', 'cookie-refresh.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 256,
      timeout: cdk.Duration.seconds(60),
      architecture: lambda.Architecture.ARM_64,
      environment: {
        SNS_TOPIC_ARN: alertTopic.topicArn,
      },
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node20',
      },
    });

    cookieRefreshFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter'],
        resources: [ssmCookieArn],
      })
    );
    cookieRefreshFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:PutParameter'],
        resources: [ssmCookieArn],
      })
    );
    alertTopic.grantPublish(cookieRefreshFn);

    // --- EventBridge Scheduler role (shared by all schedule rules) ---
    const schedulerRole = new iam.Role(this, 'SchedulerRole', {
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
    });
    announcementFn.grantInvoke(schedulerRole);
    cookieRefreshFn.grantInvoke(schedulerRole);

    // Reminder schedules are managed dynamically via the portal API
    // (portal/src/lib/scheduler/index.ts) and stored in PostgreSQL.
    // Seeded via portal/scripts/seed-reminders.ts.

    // --- EventBridge Scheduler: cookie refresh every 3 days ---
    new scheduler.CfnSchedule(this, 'CookieRefreshSchedule', {
      name: 'pudding-cookie-refresh',
      scheduleExpression: 'rate(3 days)',
      flexibleTimeWindow: { mode: 'FLEXIBLE', maximumWindowInMinutes: 60 },
      target: {
        arn: cookieRefreshFn.functionArn,
        roleArn: schedulerRole.roleArn,
        input: JSON.stringify({}),
      },
      state: 'ENABLED',
    });

    // --- CloudWatch Alarm: announcement failures ---
    const announcementErrors = announcementFn.metricErrors({
      period: cdk.Duration.minutes(5),
    });

    const alarm = new cloudwatch.Alarm(this, 'AnnouncementErrorAlarm', {
      alarmName: 'pudding-announcement-errors',
      alarmDescription: 'Fires when the announcement Lambda fails',
      metric: announcementErrors,
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    alarm.addAlarmAction(new cloudwatchActions.SnsAction(alertTopic));

    // --- SSM Parameters for Portal ---
    new ssm.StringParameter(this, 'AnnouncementFnArnParam', {
      parameterName: '/pudding/announcement-fn-arn',
      stringValue: announcementFn.functionArn,
    });

    new ssm.StringParameter(this, 'SchedulerRoleArnParam', {
      parameterName: '/pudding/scheduler-role-arn',
      stringValue: schedulerRole.roleArn,
    });

    new ssm.StringParameter(this, 'AudioBucketNameParam', {
      parameterName: '/pudding/audio-bucket-name',
      stringValue: audioBucket.bucketName,
    });

    // --- Outputs ---
    new cdk.CfnOutput(this, 'AnnouncementFunctionArn', {
      value: announcementFn.functionArn,
      description: 'Announcement Lambda ARN',
    });
    new cdk.CfnOutput(this, 'CookieRefreshFunctionArn', {
      value: cookieRefreshFn.functionArn,
      description: 'Cookie Refresh Lambda ARN',
    });
    new cdk.CfnOutput(this, 'AlertTopicArn', {
      value: alertTopic.topicArn,
      description: 'SNS Alert Topic ARN',
    });

    new cdk.CfnOutput(this, 'AudioBucketName', {
      value: audioBucket.bucketName,
      description: 'S3 bucket for audio files',
    });

    new cdk.CfnOutput(this, 'SchedulerRoleArn', {
      value: schedulerRole.roleArn,
      description: 'IAM role ARN for EventBridge Scheduler',
    });

  }
}
