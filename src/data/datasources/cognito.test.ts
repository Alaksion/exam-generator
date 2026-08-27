import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForgotPasswordCommand, UserNotFoundException } from '@aws-sdk/client-cognito-identity-provider';
import { requestPasswordReset } from './cognito.js';

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
  sendMock.mockReset();
});

describe('requestPasswordReset', () => {
  it('calls Cognito ForgotPassword with the client and email', async () => {
    sendMock.mockResolvedValue({});

    await requestPasswordReset('alice@example.com');

    expect(sendMock).toHaveBeenCalledTimes(1);
    const command = sendMock.mock.calls[0][0] as ForgotPasswordCommand;
    expect(command).toBeInstanceOf(ForgotPasswordCommand);
    expect(command.input).toMatchObject({
      ClientId: 'test-client-id',
      Username: 'alice@example.com',
    });
  });

  it('swallows UserNotFoundException so the caller cannot probe existence', async () => {
    sendMock.mockRejectedValue(new UserNotFoundException({ message: 'User does not exist.', $metadata: {} }));

    await expect(requestPasswordReset('missing@example.com')).resolves.toBeUndefined();
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('rethrows genuine downstream failures', async () => {
    sendMock.mockRejectedValue(new Error('cognito unavailable'));

    await expect(requestPasswordReset('alice@example.com')).rejects.toThrow('cognito unavailable');
  });
});