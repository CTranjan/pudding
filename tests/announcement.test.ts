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
      fakeCookie, 'DEVICE123', 'A3S5BH2HU6VAYF', 'CUSTOMER123', 'Test message'
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
      fakeCookie, 'DEVICE123', 'A3S5BH2HU6VAYF', 'CUSTOMER123', 'Announce'
    );
    expect(mockSendSpeak).not.toHaveBeenCalled();
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
});
