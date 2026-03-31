import * as https from 'https';

const ALEXA_HOST = 'alexa.amazon.com.br';

interface SequencePayload {
  behaviorId: string;
  sequenceJson: string;
  status: string;
}

type OperationNode = {
  '@type': 'com.amazon.alexa.behaviors.model.OpaquePayloadOperationNode';
  type: string;
  operationPayload: Record<string, unknown>;
};

function buildVolumeNode(deviceType: string, serialNumber: string, customerId: string, volume: number): OperationNode {
  return {
    '@type': 'com.amazon.alexa.behaviors.model.OpaquePayloadOperationNode',
    type: 'Alexa.DeviceControls.Volume',
    operationPayload: {
      deviceType,
      deviceSerialNumber: serialNumber,
      customerId,
      value: String(Math.min(10, Math.max(1, volume))),
    },
  };
}

function buildStartNode(mainNode: OperationNode, volumeNode?: OperationNode): unknown {
  if (!volumeNode) return mainNode;
  return {
    '@type': 'com.amazon.alexa.behaviors.model.SerialNode',
    nodesToExecute: [volumeNode, mainNode],
  };
}

/**
 * Gets the customer ID from the Alexa bootstrap API.
 * Required to build sequence commands.
 */
export async function getCustomerId(cookie: string): Promise<string> {
  const data = await alexaRequest('GET', '/api/bootstrap?version=0', cookie);
  const parsed = JSON.parse(data);
  const customerId = parsed?.authentication?.customerId;
  if (!customerId) {
    throw new Error('Could not extract customerId from bootstrap response');
  }
  return customerId;
}

/**
 * Gets the deviceType for a given serial number.
 */
export async function getDeviceType(cookie: string, serialNumber: string): Promise<string> {
  const data = await alexaRequest('GET', '/api/devices-v2/device?cached=true', cookie);
  const parsed = JSON.parse(data);
  const device = (parsed.devices || []).find(
    (d: Record<string, unknown>) => d.serialNumber === serialNumber
  );
  if (!device) {
    throw new Error(`Device with serial ${serialNumber} not found`);
  }
  return device.deviceType as string;
}

/**
 * Sends a speak command to a specific Echo device.
 * Uses the Alexa behaviors/preview API directly.
 */
export async function sendSpeak(
  cookie: string,
  serialNumber: string,
  deviceType: string,
  customerId: string,
  message: string,
  volume?: number
): Promise<void> {
  const speakNode: OperationNode = {
    '@type': 'com.amazon.alexa.behaviors.model.OpaquePayloadOperationNode',
    type: 'Alexa.Speak',
    operationPayload: {
      deviceType,
      deviceSerialNumber: serialNumber,
      locale: 'pt-BR',
      customerId,
      textToSpeak: message,
    },
  };

  const sequenceJson = JSON.stringify({
    '@type': 'com.amazon.alexa.behaviors.model.Sequence',
    startNode: buildStartNode(speakNode, volume !== undefined ? buildVolumeNode(deviceType, serialNumber, customerId, volume) : undefined),
  });

  const payload: SequencePayload = {
    behaviorId: 'PREVIEW',
    sequenceJson,
    status: 'ENABLED',
  };

  await alexaRequest('POST', '/api/behaviors/preview', cookie, JSON.stringify(payload));
}

/**
 * Sends an announcement to a specific Echo device.
 * Announcements can also display text on Echo Show devices.
 */
export async function sendAnnouncement(
  cookie: string,
  serialNumber: string,
  deviceType: string,
  customerId: string,
  message: string,
  speakOverride?: string,
  volume?: number
): Promise<void> {
  const announcementNode: OperationNode = {
    '@type': 'com.amazon.alexa.behaviors.model.OpaquePayloadOperationNode',
    type: 'AlexaAnnouncement',
    operationPayload: {
      expireAfter: 'PT5S',
      customerId,
      content: [
        {
          locale: 'pt-BR',
          display: { title: 'Pudding', body: message },
          speak: { type: speakOverride ? 'ssml' : 'text', value: speakOverride || message },
        },
      ],
      target: {
        customerId,
        devices: [{ deviceSerialNumber: serialNumber, deviceTypeId: deviceType }],
      },
    },
  };

  const sequenceJson = JSON.stringify({
    '@type': 'com.amazon.alexa.behaviors.model.Sequence',
    startNode: buildStartNode(announcementNode, volume !== undefined ? buildVolumeNode(deviceType, serialNumber, customerId, volume) : undefined),
  });

  const payload: SequencePayload = {
    behaviorId: 'PREVIEW',
    sequenceJson,
    status: 'ENABLED',
  };

  await alexaRequest('POST', '/api/behaviors/preview', cookie, JSON.stringify(payload));
}

/**
 * Low-level HTTPS request to the Alexa API.
 */
function alexaRequest(
  method: string,
  path: string,
  cookie: string,
  body?: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Alexa API timeout: ${method} ${path}`)), 15000);

    const options: https.RequestOptions = {
      hostname: ALEXA_HOST,
      path,
      method,
      headers: {
        Cookie: cookie,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept-Language': 'pt-BR',
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Origin: `https://${ALEXA_HOST}`,
        Referer: `https://${ALEXA_HOST}/spa/index.html`,
      },
    };

    // Extract csrf from cookie for POST requests
    if (method === 'POST') {
      const csrfMatch = cookie.match(/csrf=([^;]+)/);
      if (csrfMatch) {
        (options.headers as Record<string, string>)['csrf'] = csrfMatch[1];
      }
    }

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        clearTimeout(timeout);
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`Alexa API ${res.statusCode}: ${data.substring(0, 200)}`));
          return;
        }
        resolve(data);
      });
    });

    req.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    if (body) {
      req.write(body);
    }
    req.end();
  });
}
