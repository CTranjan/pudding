import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export const PUDDING_ENV = { account: '051162627683', region: 'us-east-2' };

export class PuddingStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Keep the id 'AudioBucket': a new id renames the logical IDs, so CloudFormation
    // would delete the bucket policy and the Echo would lose anonymous read.
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
    audioBucket.policy?.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);

    new cdk.CfnOutput(this, 'AudioBucketName', {
      value: audioBucket.bucketName,
      description: 'S3 bucket for audio files',
    });
  }
}
