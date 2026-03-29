/**
 * Pudding Setup Script
 *
 * Generates the initial Alexa session cookie and discovers the target Echo Dot.
 * Run this on a machine with a web browser:
 *
 *   npx ts-node scripts/setup.ts
 *
 * How it works:
 * 1. You log into alexa.amazon.com.br normally in your browser
 * 2. You copy your cookies from DevTools and paste them here
 * 3. The script uses those cookies to discover your Echo devices
 * 4. You select the target Echo Dot
 * 5. The script saves the cookie and device serial to AWS SSM Parameter Store
 */

import * as readline from 'readline';
import { SSMClient, PutParameterCommand } from '@aws-sdk/client-ssm';
import AlexaRemote from 'alexa-remote2';
import { ALEXA_CONFIG, SSM_PATHS, CookieData } from '../src/lib/types';

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

function askMultiline(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    console.log(prompt);
    const lines: string[] = [];
    rl.on('line', (line) => {
      if (line === '') {
        rl.close();
        resolve(lines.join('\n'));
      } else {
        lines.push(line);
      }
    });
  });
}

/**
 * Initialize alexa-remote2 with a browser cookie string to discover devices.
 */
function initAlexaWithCookie(cookieString: string): Promise<AlexaRemote> {
  return new Promise((resolve, reject) => {
    const alexa = new AlexaRemote();

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

async function saveToSSM(cookieData: string, deviceSerial: string): Promise<void> {
  console.log('\n📦 Saving to AWS SSM Parameter Store...');

  await ssmClient.send(
    new PutParameterCommand({
      Name: SSM_PATHS.cookieData,
      Value: cookieData,
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

  console.log('Step 1: Get your Alexa cookies\n');
  console.log('  1. Open your browser and go to: https://alexa.amazon.com.br');
  console.log('  2. Log in to your Amazon account if not already logged in');
  console.log('  3. Once you see the Alexa dashboard, open DevTools:');
  console.log('     - Chrome: F12 (or Cmd+Option+I on Mac)');
  console.log('     - Go to the "Application" tab (Chrome) or "Storage" tab (Firefox)');
  console.log('     - Click "Cookies" > "https://alexa.amazon.com.br"');
  console.log('  4. Now open the Console tab and paste this command:\n');
  console.log('     document.cookie\n');
  console.log('  5. Copy the ENTIRE output (it will be a long string starting with something like "session-id=...")\n');

  const cookieString = await ask('Paste your cookie string here: ');

  if (!cookieString || cookieString.length < 50) {
    console.error('❌ That doesn\'t look like a valid cookie string. It should be a long string with multiple key=value pairs.');
    process.exit(1);
  }

  console.log(`\n✅ Cookie received (${cookieString.length} characters)\n`);

  // Step 2: Initialize alexa-remote2 with the cookie to discover devices
  console.log('🔍 Discovering Echo devices...\n');

  let alexa: AlexaRemote;
  try {
    alexa = await initAlexaWithCookie(cookieString);
  } catch (error) {
    console.error('❌ Failed to connect to Alexa. Make sure you:');
    console.error('   - Copied the cookies from alexa.amazon.com.br (not amazon.com.br)');
    console.error('   - Are currently logged in when you copy the cookies');
    console.error('   - Copied the entire cookie string');
    console.error(`\n   Error: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }

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
  // Save the cookie string and the cookieData object (which includes refresh tokens)
  const cookieData = (alexa as unknown as { cookieData?: Record<string, unknown> }).cookieData;
  const dataToSave = cookieData ? JSON.stringify(cookieData) : cookieString;

  await saveToSSM(dataToSave, selectedDevice.serialNumber);

  console.log('\n🎉 Setup complete!');
  console.log('\nNext steps:');
  console.log('  1. Go back to your EC2 terminal');
  console.log('  2. Deploy:  ALERT_EMAIL=you@example.com pnpm deploy -c alertEmail=you@example.com');
  console.log('  3. Confirm the SNS email subscription');
  console.log('  4. Test:  aws lambda invoke --function-name pudding-announcement \\');
  console.log('       --payload \'{"message":"Teste!","commandType":"speak","reminderId":"test"}\' \\');
  console.log('       --cli-binary-format raw-in-base64-out --region us-east-2 out.json');

  process.exit(0);
}

main().catch((error) => {
  console.error('\n❌ Setup failed:', error.message);
  process.exit(1);
});
