import { AnnouncementEvent } from '../lib/types';
import { getCookieString, saveCookieString, getDeviceSerial } from '../lib/ssm';
import { initAlexa, sendVoiceCommand } from '../lib/alexa-client';

export const handler = async (event: AnnouncementEvent): Promise<void> => {
  const { message, commandType, reminderId } = event;

  console.log(JSON.stringify({
    action: 'announcement_start',
    reminderId,
    commandType,
    messageLength: message.length,
  }));

  const cookieString = await getCookieString();
  const deviceSerial = await getDeviceSerial();

  const alexa = await initAlexa(cookieString);

  try {
    await sendVoiceCommand(alexa, deviceSerial, message, commandType);

    console.log(JSON.stringify({
      action: 'announcement_sent',
      reminderId,
      commandType,
    }));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isCookieError =
      errorMessage.includes('cookie') ||
      errorMessage.includes('401') ||
      errorMessage.includes('auth') ||
      errorMessage.includes('Authentication');

    if (isCookieError) {
      console.log(JSON.stringify({
        action: 'cookie_error_detected',
        reminderId,
        error: errorMessage,
      }));

      // Retry with a fresh init
      const retryAlexa = await initAlexa(cookieString);
      await sendVoiceCommand(retryAlexa, deviceSerial, message, commandType);

      console.log(JSON.stringify({
        action: 'announcement_sent_after_retry',
        reminderId,
      }));
    } else {
      throw error;
    }
  }
};
