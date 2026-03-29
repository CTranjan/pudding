import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSnsSend, mockInit } = vi.hoisted(() => ({
  mockSnsSend: vi.fn(),
  mockInit: vi.fn(),
}));

// Mock AWS SSM
vi.mock('@aws-sdk/client-ssm', () => {
  const mockSend = vi.fn();
  return {
    SSMClient: vi.fn(() => ({ send: mockSend })),
    GetParameterCommand: vi.fn((input: Record<string, unknown>) => ({ input })),
    PutParameterCommand: vi.fn((input: Record<string, unknown>) => ({ input })),
    __mockSend: mockSend,
  };
});

// Mock AWS SNS
vi.mock('@aws-sdk/client-sns', () => ({
  SNSClient: vi.fn(() => ({ send: mockSnsSend })),
  PublishCommand: vi.fn((input: Record<string, unknown>) => ({ input })),
}));

// Mock alexa-remote2
vi.mock('alexa-remote2', () => {
  return {
    default: vi.fn(() => ({
      init: mockInit,
      cookieData: { localCookie: 'refreshed', tokenDate: 2000 },
    })),
  };
});

// Set env var before importing handler
process.env.SNS_TOPIC_ARN = 'arn:aws:sns:us-east-2:123456789:pudding-alerts';

import { handler } from '../src/lambda/cookie-refresh';

const getMockSend = async () => {
  const mod = await import('@aws-sdk/client-ssm') as unknown as { __mockSend: ReturnType<typeof vi.fn> };
  return mod.__mockSend;
};

const fakeCookieString = 'session-id=123; at-acbbr=Atza|abc; sess-at-acbbr=xyz';

beforeEach(() => {
  vi.clearAllMocks();
  mockSnsSend.mockResolvedValue({});

  mockInit.mockImplementation((_opts: unknown, cb: (err: Error | null) => void) => {
    cb(null);
  });
});

describe('cookie-refresh handler', () => {
  it('validates cookie and saves updated data to SSM', async () => {
    const mockSend = await getMockSend();
    mockSend
      .mockResolvedValueOnce({ Parameter: { Value: fakeCookieString } }) // get
      .mockResolvedValueOnce({}); // put

    await handler();

    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockSnsSend).not.toHaveBeenCalled();
  });

  it('publishes SNS alert when init fails (cookie expired)', async () => {
    const mockSend = await getMockSend();
    mockSend.mockResolvedValueOnce({ Parameter: { Value: fakeCookieString } });

    mockInit.mockImplementation((_opts: unknown, cb: (err: Error | null) => void) => {
      cb(new Error('Authentication failed'));
    });

    await expect(handler()).rejects.toThrow('Alexa init failed');

    expect(mockSnsSend).toHaveBeenCalledTimes(1);
  });

  it('publishes SNS alert when SSM read fails', async () => {
    const mockSend = await getMockSend();
    mockSend.mockRejectedValueOnce(new Error('SSM access denied'));

    await expect(handler()).rejects.toThrow('SSM access denied');

    expect(mockSnsSend).toHaveBeenCalledTimes(1);
  });
});
