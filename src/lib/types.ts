export interface Reminder {
  /** Unique identifier for this reminder */
  id: string;
  /** Cron expression for EventBridge Scheduler (minute hour day month day-of-week year) */
  schedule: string;
  /** Message text to be spoken by Alexa */
  message: string;
  /** Command type: 'speak' plays on target device only, 'announcement' can show on displays */
  commandType: 'speak' | 'announcement' | 'radio' | 'stop';
}

export interface CookieData {
  localCookie: string;
  csrf: string;
  macDms: {
    device_private_key: string;
    adp_token: string;
  };
  frc: string;
  'map-md': string;
  deviceId: string;
  deviceSerial: string;
  refreshToken: string;
  tokenDate: number;
  amazonPage: string;
  loginCookie: string;
  [key: string]: unknown;
}

export interface AnnouncementEvent {
  message: string;
  commandType: 'speak' | 'announcement' | 'radio' | 'stop';
  reminderId: string;
  audioUrl?: string;
  /** Optional volume level (1–10) to set before speaking. If omitted, device volume is unchanged. */
  volume?: number;
  /** Optional intro text spoken by Alexa before audio plays (only used when audioUrl is set) */
  introText?: string;
}

export const ALEXA_CONFIG = {
  amazonPage: 'amazon.com.br',
  alexaServiceHost: 'alexa.amazon.com.br',
  baseAmazonPage: 'amazon.com',
  acceptLanguage: 'pt-BR',
} as const;

export const SSM_PATHS = {
  cookieData: '/pudding/alexa-cookie-data',
  deviceSerial: '/pudding/device-serial',
} as const;
