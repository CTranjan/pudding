import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import {
  getRegistrationData,
  putCookieString,
  putRegistrationData,
} from '../lib/ssm';
import { refreshRegistration } from '../lib/alexa-cookie-refresh';

const snsClient = new SNSClient({});
const SNS_TOPIC_ARN = process.env.SNS_TOPIC_ARN!;

export const handler = async (): Promise<void> => {
  console.log(JSON.stringify({ action: 'cookie_refresh_start' }));

  let former;
  try {
    former = await getRegistrationData();
  } catch (error) {
    const msg = `Failed to read registration data from SSM: ${error instanceof Error ? error.message : error}`;
    console.error(JSON.stringify({ action: 'cookie_refresh_ssm_error', error: msg }));
    await publishAlert(msg);
    throw error;
  }

  let refreshed;
  try {
    refreshed = await refreshRegistration(former);
  } catch (error) {
    const msg = `Cookie refresh failed: ${error instanceof Error ? error.message : error}. ` +
      'The Amazon refresh token is likely revoked — re-run scripts/setup.ts via SSH tunnel to re-bootstrap.';
    console.error(JSON.stringify({ action: 'cookie_refresh_failed', error: msg }));
    await publishAlert(msg);
    throw error;
  }

  try {
    await putCookieString(refreshed.localCookie);
    await putRegistrationData(refreshed);
  } catch (error) {
    const msg = `Refresh succeeded but writing back to SSM failed: ${error instanceof Error ? error.message : error}`;
    console.error(JSON.stringify({ action: 'cookie_refresh_write_error', error: msg }));
    await publishAlert(msg);
    throw error;
  }

  console.log(JSON.stringify({ action: 'cookie_refresh_success' }));
};

async function publishAlert(message: string): Promise<void> {
  try {
    await snsClient.send(
      new PublishCommand({
        TopicArn: SNS_TOPIC_ARN,
        Subject: 'Pudding: Alexa Cookie Refresh Failed',
        Message: `${message}\n\nTo re-bootstrap:\n` +
          '1. On your laptop: ssh -L 8443:localhost:8443 ubuntu@<ec2>\n' +
          '2. On EC2: cd /home/ubuntu/projects/pudding && pnpm setup\n' +
          '3. Open https://localhost:8443/ in your laptop browser\n' +
          '4. Log in to amazon.com.br (with OTP if prompted)\n' +
          '5. Script captures refresh token and writes to SSM',
      })
    );
  } catch (snsError) {
    console.error(JSON.stringify({
      action: 'sns_publish_failed',
      error: snsError instanceof Error ? snsError.message : String(snsError),
    }));
  }
}
