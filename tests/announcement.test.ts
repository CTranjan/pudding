import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSendSequenceCommand, mockInit } = vi.hoisted(() => ({
  mockSendSequenceCommand: vi.fn(),
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

// Mock alexa-remote2
vi.mock('alexa-remote2', () => {
  return {
    default: vi.fn(() => ({
      init: mockInit,
      sendSequenceCommand: mockSendSequenceCommand,
      cookieData: {
        localCookie: 'test-cookie',
        csrf: 'test-csrf',
        tokenDate: 1000,
        refreshToken: 'test-refresh',
        amazonPage: 'amazon.com.br',
      },
    })),
  };
});

import { handler } from '../src/lambda/announcement';

// Get the mock send function
const getMockSend = async () => {
  const mod = await import('@aws-sdk/client-ssm') as unknown as { __mockSend: ReturnType<typeof vi.fn> };
  return mod.__mockSend;
};

const fakeCookieData = {
  localCookie: 'test-cookie',
  csrf: 'test-csrf',
  macDms: { device_private_key: 'key', adp_token: 'token' },
  frc: 'frc',
  'map-md': 'map',
  deviceId: 'device-id',
  deviceSerial: 'device-serial',
  refreshToken: 'refresh-token',
  tokenDate: 1000,
  amazonPage: 'amazon.com.br',
  loginCookie: 'login-cookie',
};

beforeEach(() => {
  vi.clearAllMocks();

  // alexa-remote2 init succeeds
  mockInit.mockImplementation((_opts: unknown, cb: (err: Error | null) => void) => {
    cb(null);
  });

  // sendSequenceCommand succeeds
  mockSendSequenceCommand.mockImplementation(
    (_serial: string, _type: string, _msg: string, cb: (err: Error | null) => void) => {
      cb(null);
    }
  );
});

describe('announcement handler', () => {
  it('reads SSM parameters and sends a speak command', async () => {
    const mockSend = await getMockSend();
    mockSend
      .mockResolvedValueOnce({ Parameter: { Value: JSON.stringify(fakeCookieData) } }) // cookie
      .mockResolvedValueOnce({ Parameter: { Value: 'DEVICE123' } }); // serial

    await handler({
      message: 'Test message',
      commandType: 'speak',
      reminderId: 'test-reminder',
    });

    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockInit).toHaveBeenCalledTimes(1);
    expect(mockSendSequenceCommand).toHaveBeenCalledWith(
      'DEVICE123',
      'speak',
      'Test message',
      expect.any(Function)
    );
  });

  it('sends an announcement command when specified', async () => {
    const mockSend = await getMockSend();
    mockSend
      .mockResolvedValueOnce({ Parameter: { Value: JSON.stringify(fakeCookieData) } })
      .mockResolvedValueOnce({ Parameter: { Value: 'DEVICE123' } });

    await handler({
      message: 'Announcement test',
      commandType: 'announcement',
      reminderId: 'test-announcement',
    });

    expect(mockSendSequenceCommand).toHaveBeenCalledWith(
      'DEVICE123',
      'announcement',
      'Announcement test',
      expect.any(Function)
    );
  });

  it('throws when SSM cookie parameter is missing', async () => {
    const mockSend = await getMockSend();
    mockSend.mockResolvedValueOnce({ Parameter: { Value: undefined } });

    await expect(
      handler({ message: 'Test', commandType: 'speak', reminderId: 'test' })
    ).rejects.toThrow('empty or not found');
  });

  it('retries on cookie-related errors', async () => {
    const mockSend = await getMockSend();
    mockSend
      .mockResolvedValueOnce({ Parameter: { Value: JSON.stringify(fakeCookieData) } })
      .mockResolvedValueOnce({ Parameter: { Value: 'DEVICE123' } });

    // First call fails with auth error, second succeeds
    mockSendSequenceCommand
      .mockImplementationOnce(
        (_s: string, _t: string, _m: string, cb: (err: Error | null) => void) => cb(new Error('cookie expired'))
      )
      .mockImplementationOnce(
        (_s: string, _t: string, _m: string, cb: (err: Error | null) => void) => cb(null)
      );

    await handler({ message: 'Retry test', commandType: 'speak', reminderId: 'retry' });

    expect(mockSendSequenceCommand).toHaveBeenCalledTimes(2);
    expect(mockInit).toHaveBeenCalledTimes(2);
  });

  it('throws non-cookie errors without retrying', async () => {
    const mockSend = await getMockSend();
    mockSend
      .mockResolvedValueOnce({ Parameter: { Value: JSON.stringify(fakeCookieData) } })
      .mockResolvedValueOnce({ Parameter: { Value: 'DEVICE123' } });

    mockSendSequenceCommand.mockImplementation(
      (_s: string, _t: string, _m: string, cb: (err: Error | null) => void) => cb(new Error('network timeout'))
    );

    await expect(
      handler({ message: 'Fail test', commandType: 'speak', reminderId: 'fail' })
    ).rejects.toThrow('network timeout');

    expect(mockSendSequenceCommand).toHaveBeenCalledTimes(1);
  });
});
