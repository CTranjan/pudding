#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { PuddingStack } from '../src/stack/pudding-stack';

const app = new cdk.App();

const alertEmail = app.node.tryGetContext('alertEmail') || process.env.ALERT_EMAIL;

if (!alertEmail) {
  throw new Error(
    'Missing alertEmail. Pass it via context (-c alertEmail=you@example.com) or ALERT_EMAIL env var.'
  );
}

new PuddingStack(app, 'PuddingStack', {
  alertEmail,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-2',
  },
});
