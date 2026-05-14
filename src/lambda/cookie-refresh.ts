import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { getCookieWithMeta } from '../lib/ssm';
import { validateCookiePost, summarizeCookie } from '../lib/alexa-client';

const snsClient = new SNSClient({});
const SNS_TOPIC_ARN = process.env.SNS_TOPIC_ARN!;

export const handler = async (): Promise<void> => {
  console.log(JSON.stringify({ action: 'cookie_refresh_start' }));

  let cookie: string;
  let cookieSavedAt: Date | undefined;
  try {
    const meta = await getCookieWithMeta();
    cookie = meta.value;
    cookieSavedAt = meta.lastModified;
  } catch (error) {
    const msg = `Failed to read cookie from SSM: ${error instanceof Error ? error.message : error}`;
    console.error(JSON.stringify({ action: 'cookie_refresh_ssm_error', error: msg }));
    await publishAlert(msg);
    throw error;
  }

  const cookieAgeMs = cookieSavedAt ? Date.now() - cookieSavedAt.getTime() : null;
  console.log(JSON.stringify({
    action: 'cookie_refresh_probe',
    cookieAgeHours: cookieAgeMs != null ? +(cookieAgeMs / 3_600_000).toFixed(2) : null,
    cookieSavedAt: cookieSavedAt?.toISOString() ?? null,
    cookie: summarizeCookie(cookie),
  }));

  try {
    await validateCookiePost(cookie);
    console.log(JSON.stringify({ action: 'cookie_refresh_success' }));
  } catch (error) {
    const msg = `Cookie validation failed: ${error instanceof Error ? error.message : error}. ` +
      'Announcements will start failing. Run `pnpm run bootstrap` to paste a fresh cookie.';
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
        Subject: 'Pudding: Alexa Cookie Needs Refresh',
        Message: `${message}\n\nTo fix:\n` +
          '1. Log in to https://alexa.amazon.com.br in your browser\n' +
          '2. Open DevTools > Network > refresh > copy the full Cookie header\n' +
          '3. On EC2: cd /home/ubuntu/projects/pudding && pnpm run bootstrap\n' +
          '4. Paste the cookie when prompted\n',
      })
    );
  } catch (snsError) {
    console.error(JSON.stringify({
      action: 'sns_publish_failed',
      error: snsError instanceof Error ? snsError.message : String(snsError),
    }));
  }
}
