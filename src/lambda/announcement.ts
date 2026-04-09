import { AnnouncementEvent } from '../lib/types';
import { getCookieString, getDeviceSerial } from '../lib/ssm';
import { getCustomerId, getDeviceType, sendSpeak, sendAnnouncement, sendAnnouncementWithAudio, sendRadio, sendStop, getNowPlaying } from '../lib/alexa-client';

export const handler = async (event: AnnouncementEvent): Promise<void | Record<string, unknown>> => {
  const { message, commandType, reminderId, audioUrl, volume, restoreVolume, introText } = event;

  console.log(JSON.stringify({
    action: 'announcement_start',
    reminderId,
    commandType,
    messageLength: message?.length ?? 0,
  }));

  const cookie = await getCookieString();
  const serialNumber = await getDeviceSerial();

  // Now-playing returns data instead of sending a command
  if (commandType === 'now-playing') {
    const [, deviceType] = await Promise.all([
      getCustomerId(cookie),
      getDeviceType(cookie, serialNumber),
    ]);
    const state = await getNowPlaying(cookie, serialNumber, deviceType);
    console.log(JSON.stringify({ action: 'now_playing_response', state }));
    return state;
  }

  // Build SSML when audio URL is present, optionally with intro text
  const effectiveMessage = audioUrl
    ? `<speak>${introText ? introText + ' ' : ''}<audio src="${audioUrl}"/></speak>`
    : message;

  // Get customerId and deviceType from Alexa API
  const [customerId, deviceType] = await Promise.all([
    getCustomerId(cookie),
    getDeviceType(cookie, serialNumber),
  ]);

  // Send the appropriate command
  if (commandType === 'radio') {
    await sendRadio(cookie, serialNumber, deviceType, customerId, message, volume);
  } else if (commandType === 'stop') {
    await sendStop(cookie, serialNumber, deviceType, customerId);
  } else if (commandType === 'announcement') {
    if (audioUrl) {
      // AlexaAnnouncement doesn't support <audio> SSML; use SerialNode: chime+intro → audio
      await sendAnnouncementWithAudio(cookie, serialNumber, deviceType, customerId, message, introText, audioUrl, volume, restoreVolume);
    } else {
      await sendAnnouncement(cookie, serialNumber, deviceType, customerId, message, undefined, volume, restoreVolume);
    }
  } else {
    await sendSpeak(cookie, serialNumber, deviceType, customerId, effectiveMessage, volume, restoreVolume);
  }

  console.log(JSON.stringify({
    action: 'announcement_sent',
    reminderId,
    commandType,
  }));
};
