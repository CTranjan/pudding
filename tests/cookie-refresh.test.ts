import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSnsSend, mockRefreshAlexaCookie } = vi.hoisted(() => ({
  mockSnsSend: vi.fn(),
  mockRefreshAlexaCookie: vi.fn(),
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

// Mock alexa-cookie2
vi.mock('alexa-cookie2', () => ({
  default: {
    refreshAlexaCookie: mockRefreshAlexaCookie,
  },
}));

// Set env var before importing handler
process.env.SNS_TOPIC_ARN = 'arn:aws:sns:us-east-2:123456789:pudding-alerts';

import { handler } from '../src/lambda/cookie-refresh';

const getMockSend = async () => {
  const mod = await import('@aws-sdk/client-ssm') as unknown as { __mockSend: ReturnType<typeof vi.fn> };
  return mod.__mockSend;
};

const fakeCookieData = {
  localCookie: 'test-cookie',
  csrf: 'test-csrf',
  macDms: { device_private_key: 'key', adp_token: 'token' },
  refreshToken: 'refresh-token',
  tokenDate: 1000,
  amazonPage: 'amazon.com.br',
  loginCookie: 'login-cookie',
};

const refreshedCookieData = {
  ...fakeCookieData,
  localCookie: 'new-cookie',
  csrf: 'new-csrf',
  tokenDate: 2000,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockSnsSend.mockResolvedValue({});
});

describe('cookie-refresh handler', () => {
  it('refreshes cookie and saves to SSM', async () => {
    const mockSend = await getMockSend();
    mockSend
      .mockResolvedValueOnce({ Parameter: { Value: JSON.stringify(fakeCookieData) } }) // get
      .mockResolvedValueOnce({}); // put

    mockRefreshAlexaCookie.mockImplementation(
      (_opts: unknown, cb: (err: Error | null, result: unknown) => void) => {
        cb(null, refreshedCookieData);
      }
    );

    await handler();

    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockRefreshAlexaCookie).toHaveBeenCalledTimes(1);
    expect(mockSnsSend).not.toHaveBeenCalled();
  });

  it('publishes SNS alert when refresh fails', async () => {
    const mockSend = await getMockSend();
    mockSend.mockResolvedValueOnce({ Parameter: { Value: JSON.stringify(fakeCookieData) } });

    mockRefreshAlexaCookie.mockImplementation(
      (_opts: unknown, cb: (err: Error | null, result: unknown) => void) => {
        cb(new Error('Token refresh failed'), null);
      }
    );

    await expect(handler()).rejects.toThrow('Token refresh failed');

    expect(mockSnsSend).toHaveBeenCalledTimes(1);
  });

  it('publishes SNS alert when SSM read fails', async () => {
    const mockSend = await getMockSend();
    mockSend.mockRejectedValueOnce(new Error('SSM access denied'));

    await expect(handler()).rejects.toThrow('SSM access denied');

    expect(mockSnsSend).toHaveBeenCalledTimes(1);
  });

  it('passes Brazil config to refreshAlexaCookie', async () => {
    const mockSend = await getMockSend();
    mockSend
      .mockResolvedValueOnce({ Parameter: { Value: JSON.stringify(fakeCookieData) } })
      .mockResolvedValueOnce({});

    mockRefreshAlexaCookie.mockImplementation(
      (_opts: unknown, cb: (err: Error | null, result: unknown) => void) => {
        cb(null, refreshedCookieData);
      }
    );

    await handler();

    const callArgs = mockRefreshAlexaCookie.mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs.amazonPage).toBe('amazon.com.br');
    expect(callArgs.baseAmazonPage).toBe('amazon.com');
    expect(callArgs.acceptLanguage).toBe('pt-BR');
  });
});
