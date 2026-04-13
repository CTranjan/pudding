import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSnsSend, mockRefresh } = vi.hoisted(() => ({
  mockSnsSend: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock('@aws-sdk/client-ssm', () => {
  const mockSend = vi.fn();
  return {
    SSMClient: vi.fn(() => ({ send: mockSend })),
    GetParameterCommand: vi.fn((input: Record<string, unknown>) => ({ __type: 'get', input })),
    PutParameterCommand: vi.fn((input: Record<string, unknown>) => ({ __type: 'put', input })),
    __mockSend: mockSend,
  };
});

vi.mock('@aws-sdk/client-sns', () => ({
  SNSClient: vi.fn(() => ({ send: mockSnsSend })),
  PublishCommand: vi.fn((input: Record<string, unknown>) => ({ input })),
}));

vi.mock('../src/lib/alexa-cookie-refresh', () => ({
  refreshRegistration: mockRefresh,
}));

process.env.SNS_TOPIC_ARN = 'arn:aws:sns:us-east-2:123456789:pudding-alerts';

import { handler } from '../src/lambda/cookie-refresh';

const getMockSend = async () => {
  const mod = await import('@aws-sdk/client-ssm') as unknown as { __mockSend: ReturnType<typeof vi.fn> };
  return mod.__mockSend;
};

const fakeRegistration = {
  localCookie: 'session-id=OLD; csrf=111',
  csrf: '111',
  refreshToken: 'Atnr|OLD',
  deviceSerial: 'abc',
  deviceId: 'def',
  frc: 'frc',
  'map-md': 'map',
  tokenDate: 1,
  amazonPage: 'amazon.com.br',
  loginCookie: '',
  macDms: { device_private_key: 'k', adp_token: 't' },
};

const refreshedRegistration = {
  ...fakeRegistration,
  localCookie: 'session-id=NEW; csrf=222',
  csrf: '222',
  refreshToken: 'Atnr|NEW',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockSnsSend.mockResolvedValue({});
});

describe('cookie-refresh handler', () => {
  it('refreshes cookie and writes both params back to SSM', async () => {
    const mockSend = await getMockSend();
    // 1st call: GetParameter for registration data
    mockSend.mockResolvedValueOnce({ Parameter: { Value: JSON.stringify(fakeRegistration) } });
    // 2nd call: PutParameter for cookie string
    mockSend.mockResolvedValueOnce({});
    // 3rd call: PutParameter for registration data
    mockSend.mockResolvedValueOnce({});
    mockRefresh.mockResolvedValue(refreshedRegistration);

    await handler();

    expect(mockRefresh).toHaveBeenCalledWith(fakeRegistration);
    expect(mockSend).toHaveBeenCalledTimes(3);

    const putCalls = mockSend.mock.calls
      .map((c) => c[0] as { __type?: string; input?: Record<string, unknown> })
      .filter((c) => c.__type === 'put');
    expect(putCalls).toHaveLength(2);
    expect(putCalls[0].input?.Value).toBe('session-id=NEW; csrf=222');
    expect(JSON.parse(putCalls[1].input?.Value as string).refreshToken).toBe('Atnr|NEW');

    expect(mockSnsSend).not.toHaveBeenCalled();
  });

  it('publishes SNS alert when refresh fails', async () => {
    const mockSend = await getMockSend();
    mockSend.mockResolvedValueOnce({ Parameter: { Value: JSON.stringify(fakeRegistration) } });
    mockRefresh.mockRejectedValue(new Error('refresh token expired'));

    await expect(handler()).rejects.toThrow('refresh token expired');
    expect(mockSnsSend).toHaveBeenCalledTimes(1);
  });

  it('publishes SNS alert when SSM read fails', async () => {
    const mockSend = await getMockSend();
    mockSend.mockRejectedValueOnce(new Error('SSM access denied'));

    await expect(handler()).rejects.toThrow('SSM access denied');
    expect(mockSnsSend).toHaveBeenCalledTimes(1);
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('publishes SNS alert when SSM writeback fails', async () => {
    const mockSend = await getMockSend();
    mockSend.mockResolvedValueOnce({ Parameter: { Value: JSON.stringify(fakeRegistration) } });
    mockSend.mockRejectedValueOnce(new Error('PutParameter denied'));
    mockRefresh.mockResolvedValue(refreshedRegistration);

    await expect(handler()).rejects.toThrow('PutParameter denied');
    expect(mockSnsSend).toHaveBeenCalledTimes(1);
  });
});
