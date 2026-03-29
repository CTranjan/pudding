import AlexaRemote from 'alexa-remote2';
import { CookieData, ALEXA_CONFIG } from './types';

/**
 * Initializes alexa-remote2 with a stored cookie.
 * Configured for Lambda: no push connection, no auto-refresh timer.
 */
export function initAlexa(cookieData: CookieData): Promise<AlexaRemote> {
  return new Promise((resolve, reject) => {
    const alexa = new AlexaRemote();

    alexa.init(
      {
        cookie: cookieData as unknown as string,
        amazonPage: ALEXA_CONFIG.amazonPage,
        alexaServiceHost: ALEXA_CONFIG.alexaServiceHost,
        acceptLanguage: ALEXA_CONFIG.acceptLanguage,
        usePushConnection: false,
        cookieRefreshInterval: 0,
      },
      (err: Error | null) => {
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
 *
 * @param alexa - Initialized AlexaRemote instance
 * @param deviceSerial - Target device serial number
 * @param message - Text to speak
 * @param commandType - 'speak' (target device only) or 'announcement' (can show on displays)
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

/**
 * Captures updated cookie data from the alexa instance after a potential refresh.
 * Returns null if no cookie data is available.
 */
export function getUpdatedCookieData(alexa: AlexaRemote): CookieData | null {
  const data = (alexa as unknown as { cookieData?: CookieData }).cookieData;
  return data ?? null;
}
