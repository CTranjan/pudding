import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import alexaCookie from 'alexa-cookie2';
import { CookieData, ALEXA_CONFIG } from '../lib/types';
import { getCookieData, saveCookieData } from '../lib/ssm';

const snsClient = new SNSClient({});
const SNS_TOPIC_ARN = process.env.SNS_TOPIC_ARN!;

export const handler = async (): Promise<void> => {
  console.log(JSON.stringify({ action: 'cookie_refresh_start' }));

  let cookieData: CookieData;
  try {
    cookieData = await getCookieData();
  } catch (error) {
    const msg = `Failed to read cookie from SSM: ${error instanceof Error ? error.message : error}`;
    console.error(JSON.stringify({ action: 'cookie_refresh_ssm_error', error: msg }));
    await publishAlert(msg);
    throw error;
  }

  try {
    const refreshed = await refreshCookie(cookieData);
    await saveCookieData(refreshed);

    console.log(JSON.stringify({
      action: 'cookie_refresh_success',
      tokenDate: refreshed.tokenDate,
    }));
  } catch (error) {
    const msg = `Cookie refresh failed: ${error instanceof Error ? error.message : error}. ` +
      'You need to re-run scripts/setup.ts to generate a new cookie via browser login.';

    console.error(JSON.stringify({ action: 'cookie_refresh_failed', error: msg }));
    await publishAlert(msg);
    throw error;
  }
};

function refreshCookie(cookieData: CookieData): Promise<CookieData> {
  return new Promise((resolve, reject) => {
    alexaCookie.refreshAlexaCookie({
      formerRegistrationData: cookieData as Record<string, unknown>,
      baseAmazonPage: ALEXA_CONFIG.baseAmazonPage,
      amazonPage: ALEXA_CONFIG.amazonPage,
      acceptLanguage: ALEXA_CONFIG.acceptLanguage,
    }, (err: Error | null, result: Record<string, unknown>) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(result as unknown as CookieData);
    });
  });
}

async function publishAlert(message: string): Promise<void> {
  try {
    await snsClient.send(
      new PublishCommand({
        TopicArn: SNS_TOPIC_ARN,
        Subject: '🚨 Pudding: Alexa Cookie Refresh Failed',
        Message: `${message}\n\nTo fix this, run the setup script on your local machine:\n  npx ts-node scripts/setup.ts`,
      })
    );
  } catch (snsError) {
    console.error(JSON.stringify({
      action: 'sns_publish_failed',
      error: snsError instanceof Error ? snsError.message : String(snsError),
    }));
  }
}
