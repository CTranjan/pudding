import { AnnouncementEvent } from '../lib/types';
import { getCookieData, saveCookieData, getDeviceSerial } from '../lib/ssm';
import { initAlexa, sendVoiceCommand, getUpdatedCookieData } from '../lib/alexa-client';

export const handler = async (event: AnnouncementEvent): Promise<void> => {
  const { message, commandType, reminderId } = event;

  console.log(JSON.stringify({
    action: 'announcement_start',
    reminderId,
    commandType,
    messageLength: message.length,
  }));

  const cookieData = await getCookieData();
  const deviceSerial = await getDeviceSerial();

  let alexa = await initAlexa(cookieData);

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

      // Attempt to reinitialize — alexa-remote2 may auto-refresh the cookie during init
      alexa = await initAlexa(cookieData);
      await sendVoiceCommand(alexa, deviceSerial, message, commandType);

      console.log(JSON.stringify({
        action: 'announcement_sent_after_retry',
        reminderId,
      }));
    } else {
      throw error;
    }
  }

  // Persist any refreshed cookie data
  const updatedCookie = getUpdatedCookieData(alexa);
  if (updatedCookie && updatedCookie.tokenDate !== cookieData.tokenDate) {
    await saveCookieData(updatedCookie);
    console.log(JSON.stringify({
      action: 'cookie_refreshed_and_saved',
      reminderId,
    }));
  }
};
