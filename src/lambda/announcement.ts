import { AnnouncementEvent } from '../lib/types';
import { getCookieString, getDeviceSerial } from '../lib/ssm';
import { getCustomerId, getDeviceType, sendSpeak, sendAnnouncement } from '../lib/alexa-client';

export const handler = async (event: AnnouncementEvent): Promise<void> => {
  const { message, commandType, reminderId } = event;

  console.log(JSON.stringify({
    action: 'announcement_start',
    reminderId,
    commandType,
    messageLength: message.length,
  }));

  const cookie = await getCookieString();
  const serialNumber = await getDeviceSerial();

  // Get customerId and deviceType from Alexa API
  const [customerId, deviceType] = await Promise.all([
    getCustomerId(cookie),
    getDeviceType(cookie, serialNumber),
  ]);

  // Send the voice command
  if (commandType === 'announcement') {
    await sendAnnouncement(cookie, serialNumber, deviceType, customerId, message);
  } else {
    await sendSpeak(cookie, serialNumber, deviceType, customerId, message);
  }

  console.log(JSON.stringify({
    action: 'announcement_sent',
    reminderId,
    commandType,
  }));
};
