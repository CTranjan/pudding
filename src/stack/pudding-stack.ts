import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import { Construct } from 'constructs';
import * as path from 'path';
import { REMINDERS, TIMEZONE } from '../config/reminders';
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

    // --- EventBridge Scheduler: one rule per reminder ---
    for (const reminder of REMINDERS) {
      new scheduler.CfnSchedule(this, `Schedule-${reminder.id}`, {
        name: `pudding-${reminder.id}`,
        scheduleExpression: reminder.schedule,
        scheduleExpressionTimezone: TIMEZONE,
        flexibleTimeWindow: { mode: 'OFF' },
        target: {
          arn: announcementFn.functionArn,
          roleArn: schedulerRole.roleArn,
          input: JSON.stringify({
            message: reminder.message,
            commandType: reminder.commandType,
            reminderId: reminder.id,
          }),
        },
        state: 'ENABLED',
      });
    }

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
  }
}
