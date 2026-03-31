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
const { mockGetCustomerId, mockGetDeviceType, mockSendSpeak, mockSendAnnouncement } = vi.hoisted(() => ({
  mockGetCustomerId: vi.fn(),
  mockGetDeviceType: vi.fn(),
  mockSendSpeak: vi.fn(),
  mockSendAnnouncement: vi.fn(),
}));

vi.mock('../src/lib/alexa-client', () => ({
  getCustomerId: mockGetCustomerId,
  getDeviceType: mockGetDeviceType,
  sendSpeak: mockSendSpeak,
  sendAnnouncement: mockSendAnnouncement,
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
      fakeCookie, 'DEVICE123', 'A3S5BH2HU6VAYF', 'CUSTOMER123', 'Test message', undefined
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
      fakeCookie, 'DEVICE123', 'A3S5BH2HU6VAYF', 'CUSTOMER123', 'Announce', undefined, undefined
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
      fakeCookie, 'DEVICE123', 'A3S5BH2HU6VAYF', 'CUSTOMER123', 'Test', 9
    );
  });

  it('passes volume to sendAnnouncement when provided', async () => {
    const mockSend = await getMockSend();
    mockSend
      .mockResolvedValueOnce({ Parameter: { Value: fakeCookie } })
      .mockResolvedValueOnce({ Parameter: { Value: 'DEVICE123' } });

    await handler({ message: 'Announce', commandType: 'announcement', reminderId: 'test', volume: 8 });

    expect(mockSendAnnouncement).toHaveBeenCalledWith(
      fakeCookie, 'DEVICE123', 'A3S5BH2HU6VAYF', 'CUSTOMER123', 'Announce', undefined, 8
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
      undefined
    );
  });

  it('sends SSML audio for announcement with plain text display', async () => {
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

    expect(mockSendAnnouncement).toHaveBeenCalledWith(
      fakeCookie,
      'DEVICE123',
      'A3S5BH2HU6VAYF',
      'CUSTOMER123',
      'Take medicine',
      '<speak><audio src="https://bucket.s3.amazonaws.com/test.mp3"/></speak>',
      undefined
    );
  });
});
