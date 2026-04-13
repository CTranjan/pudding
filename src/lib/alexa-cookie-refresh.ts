import { ALEXA_CONFIG, CookieData } from './types';

const alexaCookie = require('alexa-cookie2');

/**
 * Exchanges the stored refresh token for a fresh cookie bundle.
 * Returns the updated registration data — store it back to SSM so the
 * (possibly rotated) refresh token is persisted for next call.
 */
export function refreshRegistration(former: CookieData): Promise<CookieData> {
  return new Promise((resolve, reject) => {
    alexaCookie.refreshAlexaCookie(
      {
        logger: () => undefined,
        amazonPage: ALEXA_CONFIG.amazonPage,
        acceptLanguage: ALEXA_CONFIG.acceptLanguage,
        formerRegistrationData: former,
      },
      (err: Error | null, result: CookieData | undefined) => {
        if (err) return reject(err);
        if (!result || !result.localCookie) {
          return reject(new Error('refreshAlexaCookie returned no cookie'));
        }
        resolve(result);
      }
    );
  });
}
