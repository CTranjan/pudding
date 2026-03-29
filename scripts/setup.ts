/**
 * Pudding Setup Script
 *
 * Generates the initial Alexa session cookie and discovers the target Echo Dot.
 * Run this on a machine with a web browser:
 *
 *   npx ts-node scripts/setup.ts
 *
 * Steps:
 * 1. Starts a local proxy server on port 3001
 * 2. You open http://localhost:3001 in your browser and log into amazon.com.br
 * 3. The script captures the session cookie and registration data
 * 4. It initializes alexa-remote2 to list all Echo devices
 * 5. You select the target Echo Dot from the list
 * 6. The script saves cookie data and device serial to AWS SSM Parameter Store
 */

import * as readline from 'readline';
import { SSMClient, PutParameterCommand } from '@aws-sdk/client-ssm';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const alexaCookie = require('alexa-cookie2');
import AlexaRemote from 'alexa-remote2';
import { ALEXA_CONFIG, SSM_PATHS, CookieData } from '../src/lib/types';

const PROXY_PORT = 3001;
const AWS_REGION = process.env.AWS_REGION || 'us-east-2';

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

/**
 * Step 1: Use alexa-cookie2 directly to run the proxy login flow.
 * This starts a local Express server — the user logs in via browser,
 * and the cookie + registration data are returned in the callback.
 */
function loginViaProxy(): Promise<CookieData> {
  return new Promise((resolve, reject) => {
    console.log(`\n🔑 Starting login proxy on http://localhost:${PROXY_PORT}`);
    console.log('   Open this URL in your browser and log into your Amazon account.');
    console.log('   ⏳ Waiting for login...\n');

    alexaCookie.generateAlexaCookie(
      '', // email — not used in proxy mode
      '', // password — not used in proxy mode
      {
        proxyOwnIp: 'localhost',
        proxyPort: PROXY_PORT,
        amazonPage: ALEXA_CONFIG.amazonPage,
        baseAmazonPage: ALEXA_CONFIG.baseAmazonPage,
        acceptLanguage: ALEXA_CONFIG.acceptLanguage,
        setupProxy: true,
        proxyLogLevel: 'warn',
      },
      (err: Error | null, result: Record<string, unknown>) => {
        // The library calls this callback TWICE in proxy mode:
        // 1st: with an "error" that says "Please open browser..." (this is a prompt, not a real error)
        // 2nd: with the actual cookie data after successful login
        if (err) {
          const msg = String(err.message || err);
          if (msg.includes('Please open') || msg.includes('localhost')) {
            // This is the proxy startup prompt — ignore it, keep waiting
            return;
          }
          reject(new Error(`Login failed: ${msg}`));
          return;
        }
        if (!result) {
          reject(new Error('No cookie data received after login'));
          return;
        }
        resolve(result as unknown as CookieData);
      }
    );
  });
}

/**
 * Step 2: Initialize alexa-remote2 with the obtained cookie to discover devices.
 */
function initAlexaWithCookie(cookieData: CookieData): Promise<AlexaRemote> {
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
      (err) => {
        if (err) {
          reject(new Error(`Alexa init failed: ${err.message}`));
          return;
        }
        resolve(alexa);
      }
    );
  });
}

interface DeviceInfo {
  accountName: string;
  serialNumber: string;
  deviceFamily: string;
  deviceTypeFriendlyName?: string;
  online: boolean;
}

function listDevices(alexa: AlexaRemote): DeviceInfo[] {
  const devices: DeviceInfo[] = [];
  const serialNumbers = (alexa as unknown as { serialNumbers: Record<string, DeviceInfo> }).serialNumbers;

  for (const [serial, device] of Object.entries(serialNumbers)) {
    devices.push({
      accountName: device.accountName,
      serialNumber: serial,
      deviceFamily: device.deviceFamily,
      deviceTypeFriendlyName: device.deviceTypeFriendlyName,
      online: device.online,
    });
  }

  return devices;
}

async function saveToSSM(cookieData: CookieData, deviceSerial: string): Promise<void> {
  console.log('\n📦 Saving to AWS SSM Parameter Store...');

  await ssmClient.send(
    new PutParameterCommand({
      Name: SSM_PATHS.cookieData,
      Value: JSON.stringify(cookieData),
      Type: 'SecureString',
      Overwrite: true,
    })
  );
  console.log(`   ✅ ${SSM_PATHS.cookieData} (SecureString)`);

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
  console.log('🍮 Pudding Setup\n');
  console.log('This script will:');
  console.log('  1. Log into your Amazon account via browser proxy');
  console.log('  2. Discover your Echo devices');
  console.log('  3. Save credentials to AWS SSM Parameter Store\n');

  // Step 1: Login via proxy (uses alexa-cookie2 directly)
  const cookieData = await loginViaProxy();
  console.log('\n✅ Login successful! Cookie captured.\n');

  // Step 2: Initialize alexa-remote2 with the cookie to discover devices
  console.log('🔍 Discovering Echo devices...');
  const alexa = await initAlexaWithCookie(cookieData);
  const devices = listDevices(alexa);

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

  // Step 3: Select device
  const choice = await ask(`\nSelect device number [1-${devices.length}]: `);
  const deviceIndex = parseInt(choice, 10) - 1;

  if (isNaN(deviceIndex) || deviceIndex < 0 || deviceIndex >= devices.length) {
    console.error('❌ Invalid selection.');
    process.exit(1);
  }

  const selectedDevice = devices[deviceIndex];
  console.log(`\n📍 Selected: ${selectedDevice.accountName} (${selectedDevice.serialNumber})`);

  // Step 4: Save to SSM
  await saveToSSM(cookieData, selectedDevice.serialNumber);

  console.log('\n🎉 Setup complete!');
  console.log('\nNext steps:');
  console.log('  1. Deploy the CDK stack:  pnpm deploy -c alertEmail=you@example.com');
  console.log('  2. Confirm the SNS email subscription');
  console.log('  3. Test manually:  aws lambda invoke --function-name pudding-announcement \\');
  console.log('       --payload \'{"message":"Teste!","commandType":"speak","reminderId":"test"}\' out.json');

  process.exit(0);
}

main().catch((error) => {
  console.error('\n❌ Setup failed:', error.message);
  process.exit(1);
});
