import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { getCookieString } from '../lib/ssm';
import { getCustomerId } from '../lib/alexa-client';

const snsClient = new SNSClient({});
const SNS_TOPIC_ARN = process.env.SNS_TOPIC_ARN!;

export const handler = async (): Promise<void> => {
  console.log(JSON.stringify({ action: 'cookie_refresh_start' }));

  let cookie: string;
  try {
    cookie = await getCookieString();
  } catch (error) {
    const msg = `Failed to read cookie from SSM: ${error instanceof Error ? error.message : error}`;
    console.error(JSON.stringify({ action: 'cookie_refresh_ssm_error', error: msg }));
    await publishAlert(msg);
    throw error;
  }

  try {
    // Validate the cookie still works by calling the bootstrap API
    await getCustomerId(cookie);
    console.log(JSON.stringify({ action: 'cookie_refresh_success' }));
  } catch (error) {
    const msg = `Cookie validation failed: ${error instanceof Error ? error.message : error}. ` +
      'You need to re-run scripts/setup.ts to update the cookie.';

    console.error(JSON.stringify({ action: 'cookie_refresh_failed', error: msg }));
    await publishAlert(msg);
    throw error;
  }
};

async function publishAlert(message: string): Promise<void> {
  try {
    await snsClient.send(
      new PublishCommand({
        TopicArn: SNS_TOPIC_ARN,
        Subject: 'Pudding: Alexa Cookie Expired',
        Message: `${message}\n\nTo fix this:\n1. Go to alexa.amazon.com.br/api/devices-v2/device?cached=true\n2. Copy Cookie header from DevTools > Network tab\n3. Run: npx ts-node scripts/setup.ts`,
      })
    );
  } catch (snsError) {
    console.error(JSON.stringify({
      action: 'sns_publish_failed',
      error: snsError instanceof Error ? snsError.message : String(snsError),
    }));
  }
}
