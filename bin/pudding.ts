#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { PuddingStack, PUDDING_ENV } from '../src/stack/pudding-stack';

const app = new cdk.App();

new PuddingStack(app, 'PuddingStack', { env: PUDDING_ENV });
