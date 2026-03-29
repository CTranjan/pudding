declare module 'alexa-cookie2' {
  interface GenerateOptions {
    proxyOwnIp?: string;
    proxyPort?: number;
    amazonPage?: string;
    baseAmazonPage?: string;
    acceptLanguage?: string;
    setupProxy?: boolean;
    proxyLogLevel?: string;
    formerRegistrationData?: Record<string, unknown>;
    [key: string]: unknown;
  }

  interface RefreshOptions {
    formerRegistrationData: Record<string, unknown>;
    baseAmazonPage?: string;
    amazonPage?: string;
    acceptLanguage?: string;
    [key: string]: unknown;
  }

  type CookieCallback = (err: Error | null, result: Record<string, unknown>) => void;

  const alexaCookie: {
    generateAlexaCookie(
      email: string,
      password: string,
      options: GenerateOptions,
      callback: CookieCallback,
    ): void;
    refreshAlexaCookie(
      options: RefreshOptions,
      callback: CookieCallback,
    ): void;
  };

  export default alexaCookie;
}
