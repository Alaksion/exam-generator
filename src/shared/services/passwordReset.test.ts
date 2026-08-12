import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ForgotPasswordCommand, UserNotFoundException } from '@aws-sdk/client-cognito-identity-provider';
import { requestPasswordReset, ForgotPasswordRequest } from './passwordReset.js';

const sendMock = vi.hoisted(() => vi.fn());

vi.mock('@aws-sdk/client-cognito-identity-provider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aws-sdk/client-cognito-identity-provider')>();
  return {
    ...actual,
    CognitoIdentityProviderClient: class {
      send = sendMock;
    },
  };
});

beforeEach(() => {
  vi.useFakeTimers();
  sendMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

async function runWithTimers(email: string) {
  const promise = requestPasswordReset(email);
  await vi.runAllTimersAsync();
  return promise;
}

describe('requestPasswordReset', () => {
  it('calls Cognito ForgotPassword with the client and email and returns ok', async () => {
    sendMock.mockResolvedValue({});

    const result = await runWithTimers('alice@example.com');

    expect(result).toEqual({ status: 'ok' });
    expect(sendMock).toHaveBeenCalledTimes(1);
    const command = sendMock.mock.calls[0][0] as ForgotPasswordCommand;
    expect(command).toBeInstanceOf(ForgotPasswordCommand);
    expect(command.input).toMatchObject({
      ClientId: 'test-client-id',
      Username: 'alice@example.com',
    });
  });

  it('returns ok (not an error) when the user does not exist', async () => {
    sendMock.mockRejectedValue(new UserNotFoundException({ message: 'User does not exist.', $metadata: {} }));

    const result = await runWithTimers('missing@example.com');

    expect(result).toEqual({ status: 'ok' });
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('rethrows genuine downstream failures', async () => {
    sendMock.mockRejectedValue(new Error('cognito unavailable'));

    await expect(requestPasswordReset('alice@example.com')).rejects.toThrow('cognito unavailable');
  });
});

describe('ForgotPasswordRequest', () => {
  it('accepts an email and normalizes case', () => {
    expect(ForgotPasswordRequest.parse({ email: '  Alice@Example.COM  ' })).toEqual({
      email: 'alice@example.com',
    });
  });

  it('rejects an invalid email', () => {
    expect(() => ForgotPasswordRequest.parse({ email: 'not-an-email' })).toThrow();
  });
});