import {
  SSMClient,
  GetParameterCommand,
} from '@aws-sdk/client-ssm';
import { SSM_PATHS } from './types';

const ssmClient = new SSMClient({});

export async function getCookieString(): Promise<string> {
  const result = await ssmClient.send(
    new GetParameterCommand({
      Name: SSM_PATHS.cookieData,
      WithDecryption: true,
    })
  );

  const value = result.Parameter?.Value;
  if (!value) {
    throw new Error(`SSM parameter ${SSM_PATHS.cookieData} is empty or not found`);
  }

  return value;
}

export async function getDeviceSerial(): Promise<string> {
  const result = await ssmClient.send(
    new GetParameterCommand({
      Name: SSM_PATHS.deviceSerial,
    })
  );

  const value = result.Parameter?.Value;
  if (!value) {
    throw new Error(`SSM parameter ${SSM_PATHS.deviceSerial} is empty or not found`);
  }

  return value;
}
