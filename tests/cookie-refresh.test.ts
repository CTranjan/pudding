import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSnsSend, mockGetCustomerId } = vi.hoisted(() => ({
  mockSnsSend: vi.fn(),
  mockGetCustomerId: vi.fn(),
}));

// Mock AWS SSM
vi.mock('@aws-sdk/client-ssm', () => {
  const mockSend = vi.fn();
  return {
    SSMClient: vi.fn(() => ({ send: mockSend })),
    GetParameterCommand: vi.fn((input: Record<string, unknown>) => ({ input })),
    __mockSend: mockSend,
  };
});

// Mock AWS SNS
vi.mock('@aws-sdk/client-sns', () => ({
  SNSClient: vi.fn(() => ({ send: mockSnsSend })),
  PublishCommand: vi.fn((input: Record<string, unknown>) => ({ input })),
}));

// Mock alexa-client
vi.mock('../src/lib/alexa-client', () => ({
  getCustomerId: mockGetCustomerId,
}));

process.env.SNS_TOPIC_ARN = 'arn:aws:sns:us-east-2:123456789:pudding-alerts';

import { handler } from '../src/lambda/cookie-refresh';

const getMockSend = async () => {
  const mod = await import('@aws-sdk/client-ssm') as unknown as { __mockSend: ReturnType<typeof vi.fn> };
  return mod.__mockSend;
};

const fakeCookie = 'session-id=123; at-acbbr=Atza|abc';

beforeEach(() => {
  vi.clearAllMocks();
  mockSnsSend.mockResolvedValue({});
  mockGetCustomerId.mockResolvedValue('CUSTOMER123');
});

describe('cookie-refresh handler', () => {
  it('validates cookie by calling bootstrap API', async () => {
    const mockSend = await getMockSend();
    mockSend.mockResolvedValueOnce({ Parameter: { Value: fakeCookie } });

    await handler();

    expect(mockGetCustomerId).toHaveBeenCalledWith(fakeCookie);
    expect(mockSnsSend).not.toHaveBeenCalled();
  });

  it('publishes SNS alert when cookie is invalid', async () => {
    const mockSend = await getMockSend();
    mockSend.mockResolvedValueOnce({ Parameter: { Value: fakeCookie } });
    mockGetCustomerId.mockRejectedValue(new Error('Alexa API 401'));

    await expect(handler()).rejects.toThrow('Alexa API 401');
    expect(mockSnsSend).toHaveBeenCalledTimes(1);
  });

  it('publishes SNS alert when SSM read fails', async () => {
    const mockSend = await getMockSend();
    mockSend.mockRejectedValueOnce(new Error('SSM access denied'));

    await expect(handler()).rejects.toThrow('SSM access denied');
    expect(mockSnsSend).toHaveBeenCalledTimes(1);
  });
});
