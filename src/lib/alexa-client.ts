import AlexaRemote from 'alexa-remote2';
import { ALEXA_CONFIG } from './types';

/**
 * Initializes alexa-remote2 with a browser cookie string.
 * Configured for Lambda: no push connection, no auto-refresh timer.
 */
export function initAlexa(cookieString: string): Promise<AlexaRemote> {
  return new Promise((resolve, reject) => {
    const alexa = new AlexaRemote();

    const timeout = setTimeout(() => {
      reject(new Error('Alexa init timed out after 20 seconds'));
    }, 20000);

    alexa.init(
      {
        cookie: cookieString,
        amazonPage: ALEXA_CONFIG.amazonPage,
        alexaServiceHost: ALEXA_CONFIG.alexaServiceHost,
        acceptLanguage: ALEXA_CONFIG.acceptLanguage,
        usePushConnection: false,
        cookieRefreshInterval: 0,
      },
      (err) => {
        clearTimeout(timeout);
        if (err) {
          reject(new Error(`Alexa init failed: ${err.message}`));
          return;
        }
        resolve(alexa);
      }
    );
  });
}

/**
 * Sends a voice command to a specific Echo device.
 */
export function sendVoiceCommand(
  alexa: AlexaRemote,
  deviceSerial: string,
  message: string,
  commandType: 'speak' | 'announcement'
): Promise<void> {
  return new Promise((resolve, reject) => {
    alexa.sendSequenceCommand(
      deviceSerial,
      commandType,
      message,
      (err: Error | null) => {
        if (err) {
          reject(new Error(`Failed to send ${commandType}: ${err.message}`));
          return;
        }
        resolve();
      }
    );
  });
}
