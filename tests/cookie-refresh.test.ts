import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSnsSend, mockValidate } = vi.hoisted(() => ({
  mockSnsSend: vi.fn(),
  mockValidate: vi.fn(),
}));

vi.mock('@aws-sdk/client-ssm', () => {
  const mockSend = vi.fn();
  return {
    SSMClient: vi.fn(() => ({ send: mockSend })),
    GetParameterCommand: vi.fn((input: Record<string, unknown>) => ({ input })),
    __mockSend: mockSend,
  };
});

vi.mock('@aws-sdk/client-sns', () => ({
  SNSClient: vi.fn(() => ({ send: mockSnsSend })),
  PublishCommand: vi.fn((input: Record<string, unknown>) => ({ input })),
}));

vi.mock('../src/lib/alexa-client', () => ({
  validateCookiePost: mockValidate,
  summarizeCookie: (c: string) => ({ length: c.length, names: c.split(';').map((s) => s.trim().split('=')[0]) }),
}));

process.env.SNS_TOPIC_ARN = 'arn:aws:sns:us-east-2:123456789:pudding-alerts';

import { handler } from '../src/lambda/cookie-refresh';

const getMockSend = async () => {
  const mod = await import('@aws-sdk/client-ssm') as unknown as { __mockSend: ReturnType<typeof vi.fn> };
  return mod.__mockSend;
};

const fakeCookie = 'session-id=123; csrf=-1234567; at-acbbr=Atza|abc';

beforeEach(() => {
  vi.clearAllMocks();
  mockSnsSend.mockResolvedValue({});
});

describe('cookie-refresh handler', () => {
  it('validates cookie via POST /api/behaviors/preview', async () => {
    const mockSend = await getMockSend();
    mockSend.mockResolvedValueOnce({ Parameter: { Value: fakeCookie } });
    mockValidate.mockResolvedValue(undefined);

    await handler();

    expect(mockValidate).toHaveBeenCalledWith(fakeCookie);
    expect(mockSnsSend).not.toHaveBeenCalled();
  });

  it('publishes SNS alert when POST validation returns 401', async () => {
    const mockSend = await getMockSend();
    mockSend.mockResolvedValueOnce({ Parameter: { Value: fakeCookie } });
    mockValidate.mockRejectedValue(new Error('Cookie expired: POST /api/behaviors/preview returned 401'));

    await expect(handler()).rejects.toThrow('Cookie expired');
    expect(mockSnsSend).toHaveBeenCalledTimes(1);
  });

  it('publishes SNS alert when SSM read fails', async () => {
    const mockSend = await getMockSend();
    mockSend.mockRejectedValueOnce(new Error('SSM access denied'));

    await expect(handler()).rejects.toThrow('SSM access denied');
    expect(mockSnsSend).toHaveBeenCalledTimes(1);
    expect(mockValidate).not.toHaveBeenCalled();
  });
});
