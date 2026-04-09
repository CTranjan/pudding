import * as https from 'https';

const ALEXA_HOST = 'alexa.amazon.com.br';

/**
 * Strips diacritics from text so Alexa TTS pronounces Portuguese correctly.
 * E.g. "almoço" → "almoco", "ação" → "acao"
 */
function normalizeForTTS(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

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
      // Alexa API uses 0–100; UI sends 1–10, so multiply by 10
      value: String(Math.min(100, Math.max(0, volume * 10))),
    },
  };
}

function buildStartNode(mainNode: OperationNode, volumeNode?: OperationNode, restoreVolumeNode?: OperationNode): unknown {
  const nodes: OperationNode[] = [];
  if (volumeNode) nodes.push(volumeNode);
  nodes.push(mainNode);
  if (restoreVolumeNode) nodes.push(restoreVolumeNode);
  if (nodes.length === 1) return mainNode;
  return {
    '@type': 'com.amazon.alexa.behaviors.model.SerialNode',
    nodesToExecute: nodes,
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
  volume?: number,
  restoreVolume?: number
): Promise<void> {
  const speakNode: OperationNode = {
    '@type': 'com.amazon.alexa.behaviors.model.OpaquePayloadOperationNode',
    type: 'Alexa.Speak',
    operationPayload: {
      deviceType,
      deviceSerialNumber: serialNumber,
      locale: 'pt-BR',
      customerId,
      textToSpeak: normalizeForTTS(message),
    },
  };

  const sequenceJson = JSON.stringify({
    '@type': 'com.amazon.alexa.behaviors.model.Sequence',
    startNode: buildStartNode(
      speakNode,
      volume !== undefined ? buildVolumeNode(deviceType, serialNumber, customerId, volume) : undefined,
      restoreVolume !== undefined ? buildVolumeNode(deviceType, serialNumber, customerId, restoreVolume) : undefined,
    ),
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
  volume?: number,
  restoreVolume?: number
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
          speak: { type: speakOverride ? 'ssml' : 'text', value: speakOverride || normalizeForTTS(message) },
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
    startNode: buildStartNode(
      announcementNode,
      volume !== undefined ? buildVolumeNode(deviceType, serialNumber, customerId, volume) : undefined,
      restoreVolume !== undefined ? buildVolumeNode(deviceType, serialNumber, customerId, restoreVolume) : undefined,
    ),
  });

  const payload: SequencePayload = {
    behaviorId: 'PREVIEW',
    sequenceJson,
    status: 'ENABLED',
  };

  await alexaRequest('POST', '/api/behaviors/preview', cookie, JSON.stringify(payload));
}

/**
 * Sends an announcement with chime + intro text, followed by audio playback.
 * Uses a SerialNode to chain AlexaAnnouncement (chime + TTS) → Alexa.Speak (audio SSML).
 * This is needed because AlexaAnnouncement does not support <audio> SSML tags.
 */
export async function sendAnnouncementWithAudio(
  cookie: string,
  serialNumber: string,
  deviceType: string,
  customerId: string,
  displayText: string,
  introText: string | undefined,
  audioUrl: string,
  volume?: number,
  restoreVolume?: number
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
          display: { title: 'Pudding', body: displayText || 'Audio' },
          speak: { type: 'text', value: introText ? normalizeForTTS(introText) : ' ' },
        },
      ],
      target: {
        customerId,
        devices: [{ deviceSerialNumber: serialNumber, deviceTypeId: deviceType }],
      },
    },
  };

  const audioNode: OperationNode = {
    '@type': 'com.amazon.alexa.behaviors.model.OpaquePayloadOperationNode',
    type: 'Alexa.Speak',
    operationPayload: {
      deviceType,
      deviceSerialNumber: serialNumber,
      locale: 'pt-BR',
      customerId,
      textToSpeak: `<speak><audio src="${audioUrl}"/></speak>`,
    },
  };

  const nodes: OperationNode[] = [];
  if (volume !== undefined) nodes.push(buildVolumeNode(deviceType, serialNumber, customerId, volume));
  nodes.push(announcementNode);
  nodes.push(audioNode);
  if (restoreVolume !== undefined) nodes.push(buildVolumeNode(deviceType, serialNumber, customerId, restoreVolume));

  const startNode = nodes.length === 1 ? nodes[0] : {
    '@type': 'com.amazon.alexa.behaviors.model.SerialNode',
    nodesToExecute: nodes,
  };

  const sequenceJson = JSON.stringify({
    '@type': 'com.amazon.alexa.behaviors.model.Sequence',
    startNode,
  });

  const payload: SequencePayload = {
    behaviorId: 'PREVIEW',
    sequenceJson,
    status: 'ENABLED',
  };

  await alexaRequest('POST', '/api/behaviors/preview', cookie, JSON.stringify(payload));
}

/**
 * Sends a play command for a TuneIn radio station via the entertainment queue API.
 * The searchPhrase should be a TuneIn guide ID (e.g., "s17492" for JB FM).
 * If it doesn't look like a guide ID, it's used as-is with a "station" prefix.
 * If volume is specified, sets volume first via behaviors/preview, then plays.
 */
export async function sendRadio(
  cookie: string,
  serialNumber: string,
  deviceType: string,
  customerId: string,
  searchPhrase: string,
  volume?: number
): Promise<void> {
  // Set volume first if specified
  if (volume !== undefined) {
    const volumeNode = buildVolumeNode(deviceType, serialNumber, customerId, volume);
    const sequenceJson = JSON.stringify({
      '@type': 'com.amazon.alexa.behaviors.model.Sequence',
      startNode: volumeNode,
    });
    const payload: SequencePayload = {
      behaviorId: 'PREVIEW',
      sequenceJson,
      status: 'ENABLED',
    };
    await alexaRequest('POST', '/api/behaviors/preview', cookie, JSON.stringify(payload));
  }

  // Build the double-base64-encoded content token for TuneIn
  const guideId = searchPhrase;
  const encodedStationId = `["music/tuneIn/stationId","${guideId}"]|{"previousPageId":"TuneIn_SEARCH"}`;
  const encoding1 = Buffer.from(encodedStationId).toString('base64');
  const encoding2 = Buffer.from(encoding1).toString('base64');
  const body = JSON.stringify({ contentToken: `music:${encoding2}` });

  await alexaRequest(
    'PUT',
    `/api/entertainment/v1/player/queue?deviceSerialNumber=${serialNumber}&deviceType=${deviceType}`,
    cookie,
    body
  );
}

/**
 * Gets the current media state (now playing) from the device.
 * Returns provider info, content ID, title, etc.
 */
export async function getNowPlaying(
  cookie: string,
  serialNumber: string,
  deviceType: string
): Promise<Record<string, unknown>> {
  const data = await alexaRequest(
    'GET',
    `/api/np/player?deviceSerialNumber=${serialNumber}&deviceType=${deviceType}&screenWidth=1920`,
    cookie
  );
  return JSON.parse(data);
}

/**
 * Sends a stop command to halt any current playback on the device.
 */
export async function sendStop(
  cookie: string,
  serialNumber: string,
  deviceType: string,
  customerId: string
): Promise<void> {
  const stopNode: OperationNode = {
    '@type': 'com.amazon.alexa.behaviors.model.OpaquePayloadOperationNode',
    type: 'Alexa.DeviceControls.Stop',
    operationPayload: {
      deviceType,
      deviceSerialNumber: serialNumber,
      customerId,
    },
  };

  const sequenceJson = JSON.stringify({
    '@type': 'com.amazon.alexa.behaviors.model.Sequence',
    startNode: stopNode,
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

    // Extract csrf from cookie for POST/PUT requests
    if (method === 'POST' || method === 'PUT') {
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
