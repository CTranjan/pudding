import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { getCookieString, saveCookieString } from '../lib/ssm';
import { initAlexa } from '../lib/alexa-client';

const snsClient = new SNSClient({});
const SNS_TOPIC_ARN = process.env.SNS_TOPIC_ARN!;

export const handler = async (): Promise<void> => {
  console.log(JSON.stringify({ action: 'cookie_refresh_start' }));

  let cookieString: string;
  try {
    cookieString = await getCookieString();
  } catch (error) {
    const msg = `Failed to read cookie from SSM: ${error instanceof Error ? error.message : error}`;
    console.error(JSON.stringify({ action: 'cookie_refresh_ssm_error', error: msg }));
    await publishAlert(msg);
    throw error;
  }

  try {
    // Initialize alexa-remote2 — this validates the cookie is still working
    // and may internally refresh it. If init succeeds, the cookie is still valid.
    const alexa = await initAlexa(cookieString);

    // Check if alexa-remote2 produced updated cookie data
    const cookieData = (alexa as unknown as { cookieData?: Record<string, unknown> }).cookieData;
    if (cookieData) {
      // Save the full cookieData object (includes refresh tokens) for future use
      await saveCookieString(JSON.stringify(cookieData));
      console.log(JSON.stringify({ action: 'cookie_refresh_success', hasNewData: true }));
    } else {
      console.log(JSON.stringify({ action: 'cookie_refresh_success', hasNewData: false }));
    }
  } catch (error) {
    const msg = `Cookie refresh failed: ${error instanceof Error ? error.message : error}. ` +
      'You need to re-run scripts/setup.ts to generate a new cookie.';

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
        Subject: 'Pudding: Alexa Cookie Refresh Failed',
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
