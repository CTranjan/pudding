import { describe, expect, it } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { PuddingStack, PUDDING_ENV } from '../src/stack/pudding-stack';

const BUCKET_ID = 'AudioBucket96BEECBA';
const POLICY_ID = 'AudioBucketPolicy75597578';

const template = Template.fromStack(
  new PuddingStack(new cdk.App(), 'PuddingStack', { env: PUDDING_ENV }),
);
const resources = template.toJSON().Resources as Record<string, any>;

describe('PuddingStack', () => {
  it('holds only the audio bucket and its policy, under the deployed logical IDs', () => {
    expect(Object.keys(resources).sort()).toEqual([BUCKET_ID, POLICY_ID].sort());
  });

  it('retains the bucket and keeps its name', () => {
    const bucket = resources[BUCKET_ID];
    expect(bucket.DeletionPolicy).toBe('Retain');
    expect(bucket.UpdateReplacePolicy).toBe('Retain');
    expect(bucket.Properties.BucketName).toBe('pudding-audio-051162627683');
  });

  it('retains the bucket policy', () => {
    const policy = resources[POLICY_ID];
    expect(policy.DeletionPolicy).toBe('Retain');
    expect(policy.UpdateReplacePolicy).toBe('Retain');
  });

  it('lets anyone read audio/* and nothing else', () => {
    const statements = resources[POLICY_ID].Properties.PolicyDocument.Statement;
    expect(statements).toEqual([{
      Action: 's3:GetObject',
      Effect: 'Allow',
      Principal: { AWS: '*' },
      Resource: { 'Fn::Join': ['', [{ 'Fn::GetAtt': [BUCKET_ID, 'Arn'] }, '/audio/*']] },
    }]);
  });

  it('leaves public bucket policies allowed', () => {
    const block = resources[BUCKET_ID].Properties.PublicAccessBlockConfiguration;
    expect(block.BlockPublicPolicy).toBe(false);
    expect(block.RestrictPublicBuckets).toBe(false);
  });

  it('accepts browser uploads from the portal', () => {
    expect(resources[BUCKET_ID].Properties.CorsConfiguration.CorsRules).toEqual([{
      AllowedHeaders: ['*'],
      AllowedMethods: ['PUT', 'GET'],
      AllowedOrigins: ['https://c4i0apps.com'],
    }]);
  });
});
