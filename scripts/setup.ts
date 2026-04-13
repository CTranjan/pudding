/**
 * Pudding Setup Script — proxy-based bootstrap
 *
 *   npx ts-node scripts/setup.ts
 *
 * How it works:
 * 1. We start a local HTTPS proxy on port 8443 (via alexa-cookie2).
 * 2. You access it through an SSH tunnel from your laptop:
 *      ssh -L 8443:localhost:8443 ubuntu@<ec2>
 *    Then open https://127.0.0.1:8443/ in your browser (accept the self-signed cert).
 * 3. You log in to amazon.com.br normally (OTP/2FA if prompted).
 * 4. The proxy captures the full registration bundle (incl. a long-lived refresh token).
 * 5. The script then lists your Echo devices, you pick one, and everything
 *    is saved to SSM. From then on, pudding-cookie-refresh Lambda renews the
 *    cookie unattended every 3 days — no more manual cookie pasting.
 */

import * as readline from 'readline';
import * as https from 'https';
import { SSMClient, PutParameterCommand } from '@aws-sdk/client-ssm';
import { SSM_PATHS, ALEXA_CONFIG, CookieData } from '../src/lib/types';

const alexaCookie = require('alexa-cookie2');

const AWS_REGION = process.env.AWS_REGION || 'us-east-2';
const PROXY_PORT = 8443;
const PROXY_OWN_IP = '127.0.0.1';

const ssmClient = new SSMClient({ region: AWS_REGION });

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

interface AlexaDevice {
  accountName: string;
  serialNumber: string;
  deviceFamily: string;
  deviceType: string;
  deviceTypeFriendlyName?: string;
  online: boolean;
}

function fetchDevices(cookieString: string): Promise<AlexaDevice[]> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Request timed out')), 15000);

    https.get(
      `https://${ALEXA_CONFIG.alexaServiceHost}/api/devices-v2/device?cached=true`,
      {
        headers: {
          Cookie: cookieString,
          'Accept-Language': ALEXA_CONFIG.acceptLanguage,
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          Accept: 'application/json',
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          clearTimeout(timeout);
          try {
            const parsed = JSON.parse(data);
            const devices: AlexaDevice[] = (parsed.devices || []).map((d: Record<string, unknown>) => ({
              accountName: d.accountName as string,
              serialNumber: d.serialNumber as string,
              deviceFamily: d.deviceFamily as string,
              deviceType: d.deviceType as string,
              deviceTypeFriendlyName: d.deviceTypeFriendlyName as string | undefined,
              online: Boolean(d.online),
            }));
            resolve(devices);
          } catch {
            reject(new Error(`Failed to parse API response: ${data.substring(0, 200)}`));
          }
        });
      }
    ).on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

function runProxyLogin(): Promise<CookieData> {
  return new Promise((resolve, reject) => {
    console.log('\n🌐 Starting Alexa proxy server...\n');
    console.log(`   1. On your laptop, open an SSH tunnel:`);
    console.log(`      ssh -L ${PROXY_PORT}:localhost:${PROXY_PORT} ubuntu@<this-ec2-host>\n`);
    console.log(`   2. In your laptop browser, open:`);
    console.log(`      https://${PROXY_OWN_IP}:${PROXY_PORT}/`);
    console.log(`      (accept the self-signed cert warning)\n`);
    console.log(`   3. Log in to amazon.com.br normally (OTP/2FA if prompted).`);
    console.log(`   4. When the proxy succeeds, you'll see a success page.\n`);
    console.log('⏳ Waiting for login...\n');

    alexaCookie.generateAlexaCookie(
      undefined,
      undefined,
      {
        logger: (msg: string) => process.stdout.write(`   [proxy] ${msg}\n`),
        proxyOnly: true,
        setupProxy: true,
        proxyOwnIp: PROXY_OWN_IP,
        proxyPort: PROXY_PORT,
        proxyListenBind: '0.0.0.0',
        amazonPage: ALEXA_CONFIG.amazonPage,
        acceptLanguage: ALEXA_CONFIG.acceptLanguage,
        baseAmazonPage: ALEXA_CONFIG.baseAmazonPage,
        deviceAppName: 'Pudding',
      },
      (err: Error | null, result: CookieData | undefined) => {
        try {
          alexaCookie.stopProxyServer();
        } catch {
          // ignore
        }
        if (err) return reject(err);
        if (!result || !result.localCookie) {
          return reject(new Error('Proxy returned no cookie — login likely incomplete'));
        }
        resolve(result);
      }
    );
  });
}

async function saveToSSM(
  cookieString: string,
  registrationData: CookieData,
  deviceSerial: string,
): Promise<void> {
  console.log('\n📦 Saving to AWS SSM Parameter Store...');

  await ssmClient.send(
    new PutParameterCommand({
      Name: SSM_PATHS.cookieData,
      Value: cookieString,
      Type: 'SecureString',
      Overwrite: true,
    })
  );
  console.log(`   ✅ ${SSM_PATHS.cookieData} (SecureString)`);

  await ssmClient.send(
    new PutParameterCommand({
      Name: SSM_PATHS.registrationData,
      Value: JSON.stringify(registrationData),
      Type: 'SecureString',
      Overwrite: true,
    })
  );
  console.log(`   ✅ ${SSM_PATHS.registrationData} (SecureString)`);

  await ssmClient.send(
    new PutParameterCommand({
      Name: SSM_PATHS.deviceSerial,
      Value: deviceSerial,
      Type: 'String',
      Overwrite: true,
    })
  );
  console.log(`   ✅ ${SSM_PATHS.deviceSerial}`);
}

async function main(): Promise<void> {
  console.log('🍮 Pudding Setup — proxy bootstrap\n');

  const registration = await runProxyLogin();
  console.log(`\n✅ Login successful. Got refresh token (${registration.refreshToken.length} chars).\n`);

  console.log('🔍 Discovering Echo devices...\n');
  const devices = await fetchDevices(registration.localCookie);

  if (devices.length === 0) {
    console.error('❌ No Echo devices found on this account.');
    process.exit(1);
  }

  console.log('📱 Found devices:\n');
  devices.forEach((device, index) => {
    const status = device.online ? '🟢' : '🔴';
    const type = device.deviceTypeFriendlyName || device.deviceFamily;
    console.log(`  ${index + 1}. ${status} ${device.accountName} (${type}) — Serial: ${device.serialNumber}`);
  });

  const choice = await ask(`\nSelect device number [1-${devices.length}]: `);
  const deviceIndex = parseInt(choice, 10) - 1;

  if (isNaN(deviceIndex) || deviceIndex < 0 || deviceIndex >= devices.length) {
    console.error('❌ Invalid selection.');
    process.exit(1);
  }

  const selectedDevice = devices[deviceIndex];
  console.log(`\n📍 Selected: ${selectedDevice.accountName} (${selectedDevice.serialNumber})`);

  await saveToSSM(registration.localCookie, registration, selectedDevice.serialNumber);

  console.log('\n🎉 Bootstrap complete!');
  console.log('\nFrom now on, pudding-cookie-refresh Lambda will auto-renew every 3 days.');
  console.log('Test the announcement Lambda:');
  console.log('  aws lambda invoke --function-name pudding-announcement \\');
  console.log('    --payload \'{"message":"Teste!","commandType":"speak","reminderId":"test"}\' \\');
  console.log('    --cli-binary-format raw-in-base64-out --region us-east-2 out.json');

  process.exit(0);
}

main().catch((error) => {
  console.error('\n❌ Setup failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
