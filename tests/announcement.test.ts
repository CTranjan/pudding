import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock AWS SSM
vi.mock('@aws-sdk/client-ssm', () => {
  const mockSend = vi.fn();
  return {
    SSMClient: vi.fn(() => ({ send: mockSend })),
    GetParameterCommand: vi.fn((input: Record<string, unknown>) => ({ input })),
    __mockSend: mockSend,
  };
});

// Mock our alexa-client module
const { mockGetCustomerId, mockGetDeviceType, mockSendSpeak, mockSendAnnouncement, mockSendAnnouncementWithAudio, mockSendRadio, mockSendStop } = vi.hoisted(() => ({
  mockGetCustomerId: vi.fn(),
  mockGetDeviceType: vi.fn(),
  mockSendSpeak: vi.fn(),
  mockSendAnnouncement: vi.fn(),
  mockSendAnnouncementWithAudio: vi.fn(),
  mockSendRadio: vi.fn(),
  mockSendStop: vi.fn(),
}));

vi.mock('../src/lib/alexa-client', () => ({
  getCustomerId: mockGetCustomerId,
  getDeviceType: mockGetDeviceType,
  sendSpeak: mockSendSpeak,
  sendAnnouncement: mockSendAnnouncement,
  sendAnnouncementWithAudio: mockSendAnnouncementWithAudio,
  sendRadio: mockSendRadio,
  sendStop: mockSendStop,
  summarizeCookie: (c: string) => ({ length: c.length, names: c.split(';').map((s) => s.trim().split('=')[0]) }),
}));

import { handler } from '../src/lambda/announcement';

const getMockSend = async () => {
  const mod = await import('@aws-sdk/client-ssm') as unknown as { __mockSend: ReturnType<typeof vi.fn> };
  return mod.__mockSend;
};

const fakeCookie = 'session-id=123; at-acbbr=Atza|abc';

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCustomerId.mockResolvedValue('CUSTOMER123');
  mockGetDeviceType.mockResolvedValue('A3S5BH2HU6VAYF');
  mockSendSpeak.mockResolvedValue(undefined);
  mockSendAnnouncement.mockResolvedValue(undefined);
  mockSendAnnouncementWithAudio.mockResolvedValue(undefined);
  mockSendRadio.mockResolvedValue(undefined);
  mockSendStop.mockResolvedValue(undefined);
});

describe('announcement handler', () => {
  it('reads SSM parameters and sends a speak command', async () => {
    const mockSend = await getMockSend();
    mockSend
      .mockResolvedValueOnce({ Parameter: { Value: fakeCookie } })
      .mockResolvedValueOnce({ Parameter: { Value: 'DEVICE123' } });

    await handler({ message: 'Test message', commandType: 'speak', reminderId: 'test' });

    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockGetCustomerId).toHaveBeenCalledWith(fakeCookie);
    expect(mockGetDeviceType).toHaveBeenCalledWith(fakeCookie, 'DEVICE123');
    expect(mockSendSpeak).toHaveBeenCalledWith(
      fakeCookie, 'DEVICE123', 'A3S5BH2HU6VAYF', 'CUSTOMER123', 'Test message', undefined, undefined
    );
    expect(mockSendAnnouncement).not.toHaveBeenCalled();
  });

  it('sends an announcement command when specified', async () => {
    const mockSend = await getMockSend();
    mockSend
      .mockResolvedValueOnce({ Parameter: { Value: fakeCookie } })
      .mockResolvedValueOnce({ Parameter: { Value: 'DEVICE123' } });

    await handler({ message: 'Announce', commandType: 'announcement', reminderId: 'test' });

    expect(mockSendAnnouncement).toHaveBeenCalledWith(
      fakeCookie, 'DEVICE123', 'A3S5BH2HU6VAYF', 'CUSTOMER123', 'Announce', undefined, undefined, undefined
    );
    expect(mockSendSpeak).not.toHaveBeenCalled();
  });

  it('passes volume to sendSpeak when provided', async () => {
    const mockSend = await getMockSend();
    mockSend
      .mockResolvedValueOnce({ Parameter: { Value: fakeCookie } })
      .mockResolvedValueOnce({ Parameter: { Value: 'DEVICE123' } });

    await handler({ message: 'Test', commandType: 'speak', reminderId: 'test', volume: 9 });

    expect(mockSendSpeak).toHaveBeenCalledWith(
      fakeCookie, 'DEVICE123', 'A3S5BH2HU6VAYF', 'CUSTOMER123', 'Test', 9, undefined
    );
  });

  it('passes volume to sendAnnouncement when provided', async () => {
    const mockSend = await getMockSend();
    mockSend
      .mockResolvedValueOnce({ Parameter: { Value: fakeCookie } })
      .mockResolvedValueOnce({ Parameter: { Value: 'DEVICE123' } });

    await handler({ message: 'Announce', commandType: 'announcement', reminderId: 'test', volume: 8 });

    expect(mockSendAnnouncement).toHaveBeenCalledWith(
      fakeCookie, 'DEVICE123', 'A3S5BH2HU6VAYF', 'CUSTOMER123', 'Announce', undefined, 8, undefined
    );
  });

  it('throws when SSM cookie parameter is missing', async () => {
    const mockSend = await getMockSend();
    mockSend.mockResolvedValueOnce({ Parameter: { Value: undefined } });

    await expect(
      handler({ message: 'Test', commandType: 'speak', reminderId: 'test' })
    ).rejects.toThrow('empty or not found');
  });

  it('propagates Alexa API errors', async () => {
    const mockSend = await getMockSend();
    mockSend
      .mockResolvedValueOnce({ Parameter: { Value: fakeCookie } })
      .mockResolvedValueOnce({ Parameter: { Value: 'DEVICE123' } });

    mockSendSpeak.mockRejectedValue(new Error('Alexa API 401'));

    await expect(
      handler({ message: 'Test', commandType: 'speak', reminderId: 'test' })
    ).rejects.toThrow('Alexa API 401');
  });

  it('wraps audioUrl in SSML and sends via speak', async () => {
    const mockSend = await getMockSend();
    mockSend
      .mockResolvedValueOnce({ Parameter: { Value: fakeCookie } })
      .mockResolvedValueOnce({ Parameter: { Value: 'DEVICE123' } });

    await handler({
      message: 'Take medicine',
      commandType: 'speak',
      reminderId: 'test',
      audioUrl: 'https://bucket.s3.amazonaws.com/test.mp3',
    });

    expect(mockSendSpeak).toHaveBeenCalledWith(
      fakeCookie,
      'DEVICE123',
      'A3S5BH2HU6VAYF',
      'CUSTOMER123',
      '<speak><audio src="https://bucket.s3.amazonaws.com/test.mp3"/></speak>',
      undefined,
      undefined
    );
  });

  it('sends announcement with audio via sendAnnouncementWithAudio', async () => {
    const mockSend = await getMockSend();
    mockSend
      .mockResolvedValueOnce({ Parameter: { Value: fakeCookie } })
      .mockResolvedValueOnce({ Parameter: { Value: 'DEVICE123' } });

    await handler({
      message: 'Take medicine',
      commandType: 'announcement',
      reminderId: 'test',
      audioUrl: 'https://bucket.s3.amazonaws.com/test.mp3',
    });

    expect(mockSendAnnouncementWithAudio).toHaveBeenCalledWith(
      fakeCookie,
      'DEVICE123',
      'A3S5BH2HU6VAYF',
      'CUSTOMER123',
      'Take medicine',
      undefined,
      'https://bucket.s3.amazonaws.com/test.mp3',
      undefined,
      undefined
    );
    expect(mockSendAnnouncement).not.toHaveBeenCalled();
  });

  it('sends announcement with audio + intro + volume via sendAnnouncementWithAudio', async () => {
    const mockSend = await getMockSend();
    mockSend
      .mockResolvedValueOnce({ Parameter: { Value: fakeCookie } })
      .mockResolvedValueOnce({ Parameter: { Value: 'DEVICE123' } });

    await handler({
      message: 'Take medicine',
      commandType: 'announcement',
      reminderId: 'test',
      audioUrl: 'https://bucket.s3.amazonaws.com/test.mp3',
      introText: 'Mensagem de Caio',
      volume: 8,
      restoreVolume: 4,
    });

    expect(mockSendAnnouncementWithAudio).toHaveBeenCalledWith(
      fakeCookie,
      'DEVICE123',
      'A3S5BH2HU6VAYF',
      'CUSTOMER123',
      'Take medicine',
      'Mensagem de Caio',
      'https://bucket.s3.amazonaws.com/test.mp3',
      8,
      4
    );
    expect(mockSendAnnouncement).not.toHaveBeenCalled();
  });

  it('prepends introText before audio in SSML', async () => {
    const mockSend = await getMockSend();
    mockSend
      .mockResolvedValueOnce({ Parameter: { Value: fakeCookie } })
      .mockResolvedValueOnce({ Parameter: { Value: 'DEVICE123' } });

    await handler({
      message: '',
      commandType: 'speak',
      reminderId: 'test',
      audioUrl: 'https://bucket.s3.amazonaws.com/test.mp3',
      introText: 'Mensagem de Caio e Igor',
    });

    expect(mockSendSpeak).toHaveBeenCalledWith(
      fakeCookie,
      'DEVICE123',
      'A3S5BH2HU6VAYF',
      'CUSTOMER123',
      '<speak>Mensagem de Caio e Igor <audio src="https://bucket.s3.amazonaws.com/test.mp3"/></speak>',
      undefined,
      undefined
    );
  });

  it('sends radio command with search phrase', async () => {
    const mockSend = await getMockSend();
    mockSend
      .mockResolvedValueOnce({ Parameter: { Value: fakeCookie } })
      .mockResolvedValueOnce({ Parameter: { Value: 'DEVICE123' } });

    await handler({
      message: 'JB FM',
      commandType: 'radio',
      reminderId: 'radio-morning',
      volume: 7,
    });

    expect(mockSendRadio).toHaveBeenCalledWith(
      fakeCookie, 'DEVICE123', 'A3S5BH2HU6VAYF', 'CUSTOMER123', 'JB FM', 7
    );
    expect(mockSendSpeak).not.toHaveBeenCalled();
  });

  it('sends stop command', async () => {
    const mockSend = await getMockSend();
    mockSend
      .mockResolvedValueOnce({ Parameter: { Value: fakeCookie } })
      .mockResolvedValueOnce({ Parameter: { Value: 'DEVICE123' } });

    await handler({
      message: '',
      commandType: 'stop',
      reminderId: 'radio-stop',
    });

    expect(mockSendStop).toHaveBeenCalledWith(
      fakeCookie, 'DEVICE123', 'A3S5BH2HU6VAYF', 'CUSTOMER123'
    );
    expect(mockSendSpeak).not.toHaveBeenCalled();
    expect(mockSendRadio).not.toHaveBeenCalled();
  });
});
