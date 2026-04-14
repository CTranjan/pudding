/**
 * Pudding Setup Script — manual cookie paste
 *
 *   pnpm run bootstrap   (or: npx ts-node scripts/setup.ts)
 *
 * How it works:
 * 1. You log into alexa.amazon.com.br in your browser
 * 2. Copy the full Cookie header from DevTools > Network tab
 * 3. Paste it here — the script calls the Alexa API directly to list devices
 * 4. You select the target Echo Dot
 * 5. The script saves the cookie and device serial to SSM
 *
 * Note: automated refresh via alexa-cookie2 was tried but Amazon's anti-fraud
 * blocks device registration from EC2 IPs. Manual paste every ~7-14 days
 * remains the reliable option. The pudding-cookie-refresh Lambda validates
 * the cookie every 3 days and SNS-alerts before announcements start failing.
 */

import * as readline from 'readline';
import * as https from 'https';
import { SSMClient, PutParameterCommand } from '@aws-sdk/client-ssm';
import { SSM_PATHS, ALEXA_CONFIG } from '../src/lib/types';

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

async function saveToSSM(cookieString: string, deviceSerial: string): Promise<void> {
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

  console.log('Step 1: Get your Alexa cookie\n');
  console.log('  1. Go to www.amazon.com.br and make sure you are logged in');
  console.log('  2. Navigate to: https://alexa.amazon.com.br/api/devices-v2/device?cached=true');
  console.log('  3. Press F12 > Network tab > refresh the page');
  console.log('  4. Click the first request > Request Headers > copy the Cookie: value\n');

  const cookieString = await ask('Paste your cookie string here: ');

  if (!cookieString || cookieString.length < 100) {
    console.error('❌ That does not look like a valid cookie string.');
    process.exit(1);
  }

  console.log(`\n✅ Cookie received (${cookieString.length} characters)\n`);

  console.log('🔍 Discovering Echo devices...\n');
  const devices = await fetchDevices(cookieString);

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

  await saveToSSM(cookieString, selectedDevice.serialNumber);

  console.log('\n🎉 Setup complete!');
  console.log('\nTest the announcement Lambda:');
  console.log('  aws lambda invoke --function-name pudding-announcement \\');
  console.log('    --payload \'{"message":"Teste!","commandType":"speak","reminderId":"test"}\' \\');
  console.log('    --cli-binary-format raw-in-base64-out --region us-east-2 out.json');

  process.exit(0);
}

main().catch((error) => {
  console.error('\n❌ Setup failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
