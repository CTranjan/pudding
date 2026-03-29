import {
  SSMClient,
  GetParameterCommand,
  PutParameterCommand,
} from '@aws-sdk/client-ssm';
import { CookieData, SSM_PATHS } from './types';

const ssmClient = new SSMClient({});

export async function getCookieData(): Promise<CookieData> {
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

  return JSON.parse(value) as CookieData;
}

export async function saveCookieData(data: CookieData): Promise<void> {
  await ssmClient.send(
    new PutParameterCommand({
      Name: SSM_PATHS.cookieData,
      Value: JSON.stringify(data),
      Type: 'SecureString',
      Overwrite: true,
    })
  );
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
