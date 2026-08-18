import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PreSignUpTriggerEvent, PostConfirmationConfirmSignUpTriggerEvent } from 'aws-lambda';
import { handler, EmailLockedError, SignupNotAllowedError } from './index.js';
import * as usersRepo from '../shared/repositories/users.js';

vi.mock('../shared/repositories/users.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../shared/repositories/users.js')>();
  return {
    ...actual,
    getUserByEmail: vi.fn(),
    createUser: vi.fn(),
  };
});

const mockedGetUserByEmail = vi.mocked(usersRepo.getUserByEmail);
const mockedCreateUser = vi.mocked(usersRepo.createUser);

beforeEach(() => {
  vi.clearAllMocks();
  mockedCreateUser.mockResolvedValue('created');
  process.env.SIGNUP_MODE = 'open';
  process.env.BETA_ALLOWLIST = '';
});

afterEach(() => {
  delete process.env.SIGNUP_MODE;
  delete process.env.BETA_ALLOWLIST;
});

const shared = {
  version: '1',
  region: 'us-east-1',
  userPoolId: 'us-east-1_test',
  userName: 'alice@example.com',
  callerContext: { awsSdkVersion: '2', clientId: 'client-id' },
  request: {},
  response: {},
};

function preSignUp(
  overrides: { userAttributes?: Record<string, string>; source?: string } = {},
): PreSignUpTriggerEvent {
  return {
    ...shared,
    triggerSource: (overrides.source ?? 'PreSignUp_SignUp') as PreSignUpTriggerEvent['triggerSource'],
    request: { userAttributes: overrides.userAttributes ?? { email: 'alice@example.com' }, validationData: {} },
    response: { autoConfirmUser: false, autoVerifyEmail: false, autoVerifyPhone: false },
  } as unknown as PreSignUpTriggerEvent;
}

function postConfirmation(userAttributes: Record<string, string> = { sub: 'sub-123', email: 'Alice@Example.com' }): PostConfirmationConfirmSignUpTriggerEvent {
  return {
    ...shared,
    triggerSource: 'PostConfirmation_ConfirmSignUp',
    request: { userAttributes },
  } as unknown as PostConfirmationConfirmSignUpTriggerEvent;
}

describe('PreSignUp email lock', () => {
  it('allows a sign-up when the email is not claimed', async () => {
    mockedGetUserByEmail.mockResolvedValue(null);

    const result = await handler(preSignUp());

    expect(result).toEqual(expect.objectContaining({ triggerSource: 'PreSignUp_SignUp' }));
    expect(mockedGetUserByEmail).toHaveBeenCalledWith('alice@example.com');
    expect(mockedCreateUser).not.toHaveBeenCalled();
  });

  it('blocks a native sign-up when the email is already claimed', async () => {
    mockedGetUserByEmail.mockResolvedValue({
      userId: 'existing-sub',
      email: 'alice@example.com',
      role: 'customer',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    await expect(handler(preSignUp())).rejects.toBeInstanceOf(EmailLockedError);
  });

  it('blocks a federated sign-up when the email is already claimed', async () => {
    mockedGetUserByEmail.mockResolvedValue({
      userId: 'existing-sub',
      email: 'alice@example.com',
      role: 'customer',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    const event = preSignUp({ source: 'PreSignUp_ExternalProvider' });

    await expect(handler(event)).rejects.toBeInstanceOf(EmailLockedError);
  });

  it('blocks a Google sign-up when the email is already claimed by an email/password account', async () => {
    mockedGetUserByEmail.mockResolvedValue({
      userId: 'existing-sub',
      email: 'alice@example.com',
      role: 'customer',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    const event = preSignUp({ source: 'PreSignUp_ExternalProvider', userAttributes: { email: 'alice@example.com' } });

    await expect(handler(event)).rejects.toBeInstanceOf(EmailLockedError);
  });

  it('blocks an email/password sign-up when the email is already claimed by a Google account', async () => {
    mockedGetUserByEmail.mockResolvedValue({
      userId: 'google-sub',
      email: 'alice@example.com',
      role: 'customer',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    await expect(handler(preSignUp())).rejects.toBeInstanceOf(EmailLockedError);
  });

  it('blocks an Apple sign-up when the email is already claimed by an email/password account', async () => {
    mockedGetUserByEmail.mockResolvedValue({
      userId: 'existing-sub',
      email: 'alice@example.com',
      role: 'customer',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    const event = preSignUp({ source: 'PreSignUp_ExternalProvider', userAttributes: { email: 'alice@example.com' } });

    await expect(handler(event)).rejects.toBeInstanceOf(EmailLockedError);
  });

  it('blocks an Apple sign-up when the email is already claimed by a Google account', async () => {
    mockedGetUserByEmail.mockResolvedValue({
      userId: 'google-sub',
      email: 'alice@example.com',
      role: 'customer',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    const event = preSignUp({ source: 'PreSignUp_ExternalProvider', userAttributes: { email: 'alice@example.com' } });

    await expect(handler(event)).rejects.toBeInstanceOf(EmailLockedError);
  });

  it('blocks an email/password sign-up when the email is already claimed by an Apple account', async () => {
    mockedGetUserByEmail.mockResolvedValue({
      userId: 'apple-sub',
      email: 'alice@example.com',
      role: 'customer',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    await expect(handler(preSignUp())).rejects.toBeInstanceOf(EmailLockedError);
  });

  it('auto-confirms and auto-verifies a first-time federated sign-up', async () => {
    mockedGetUserByEmail.mockResolvedValue(null);

    const result = (await handler(preSignUp({ source: 'PreSignUp_ExternalProvider' }))) as PreSignUpTriggerEvent;

    expect(result.response.autoConfirmUser).toBe(true);
    expect(result.response.autoVerifyEmail).toBe(true);
    expect(mockedCreateUser).not.toHaveBeenCalled();
  });

  it('does not auto-confirm a native email/password sign-up', async () => {
    mockedGetUserByEmail.mockResolvedValue(null);

    const result = await handler(preSignUp());

    const response = (result as { response?: Record<string, unknown> }).response ?? {};
    expect(response.autoConfirmUser).toBe(false);
  });

  it('allows a sign-up without an email attribute to proceed', async () => {
    mockedGetUserByEmail.mockResolvedValue(null);

    const result = await handler(preSignUp({ userAttributes: {} }));

    expect(result).toBeDefined();
    expect(mockedGetUserByEmail).not.toHaveBeenCalled();
  });
});

describe('PreSignUp invite-only allowlist', () => {
  it('allows an allowlisted email in invite mode', async () => {
    process.env.SIGNUP_MODE = 'invite';
    process.env.BETA_ALLOWLIST = 'alice@example.com';
    mockedGetUserByEmail.mockResolvedValue(null);

    const result = await handler(preSignUp());

    expect(result.triggerSource).toBe('PreSignUp_SignUp');
    expect(mockedGetUserByEmail).toHaveBeenCalledWith('alice@example.com');
  });

  it('allows an email matching an allowlisted domain in invite mode', async () => {
    process.env.SIGNUP_MODE = 'invite';
    process.env.BETA_ALLOWLIST = 'example.com';
    mockedGetUserByEmail.mockResolvedValue(null);

    const result = await handler(preSignUp());

    expect(result.triggerSource).toBe('PreSignUp_SignUp');
    expect(mockedGetUserByEmail).toHaveBeenCalledWith('alice@example.com');
  });

  it('matches the allowlist case-insensitively', async () => {
    process.env.SIGNUP_MODE = 'invite';
    process.env.BETA_ALLOWLIST = 'Alice@Example.com, Example.COM';
    mockedGetUserByEmail.mockResolvedValue(null);

    const result = await handler(preSignUp());

    expect(result.triggerSource).toBe('PreSignUp_SignUp');
    expect(mockedGetUserByEmail).toHaveBeenCalledWith('alice@example.com');
  });

  it('blocks a native sign-up for an email not on the allowlist', async () => {
    process.env.SIGNUP_MODE = 'invite';
    process.env.BETA_ALLOWLIST = 'bob@example.com';
    mockedGetUserByEmail.mockResolvedValue(null);

    await expect(handler(preSignUp())).rejects.toBeInstanceOf(SignupNotAllowedError);
    expect(mockedGetUserByEmail).not.toHaveBeenCalled();
  });

  it('blocks an admin-created user whose email is not on the allowlist', async () => {
    process.env.SIGNUP_MODE = 'invite';
    process.env.BETA_ALLOWLIST = 'bob@example.com';
    mockedGetUserByEmail.mockResolvedValue(null);

    const event = preSignUp({ source: 'PreSignUp_AdminCreateUser' });

    await expect(handler(event)).rejects.toBeInstanceOf(SignupNotAllowedError);
    expect(mockedGetUserByEmail).not.toHaveBeenCalled();
  });

  it('allows an admin-created user on the allowlist', async () => {
    process.env.SIGNUP_MODE = 'invite';
    process.env.BETA_ALLOWLIST = 'alice@example.com';
    mockedGetUserByEmail.mockResolvedValue(null);

    const result = await handler(preSignUp({ source: 'PreSignUp_AdminCreateUser' }));

    expect(result.triggerSource).toBe('PreSignUp_AdminCreateUser');
    expect(mockedGetUserByEmail).toHaveBeenCalledWith('alice@example.com');
  });

  it('blocks a federated sign-up for an email not on the allowlist', async () => {
    process.env.SIGNUP_MODE = 'invite';
    process.env.BETA_ALLOWLIST = 'bob@example.com';
    mockedGetUserByEmail.mockResolvedValue(null);

    const event = preSignUp({ source: 'PreSignUp_ExternalProvider' });

    await expect(handler(event)).rejects.toBeInstanceOf(SignupNotAllowedError);
    expect(mockedGetUserByEmail).not.toHaveBeenCalled();
  });

  it('blocks an email-less sign-up in invite mode', async () => {
    process.env.SIGNUP_MODE = 'invite';
    process.env.BETA_ALLOWLIST = 'alice@example.com';
    mockedGetUserByEmail.mockResolvedValue(null);

    const native = preSignUp({ userAttributes: {} });
    const federated = preSignUp({ source: 'PreSignUp_ExternalProvider', userAttributes: {} });

    await expect(handler(native)).rejects.toBeInstanceOf(SignupNotAllowedError);
    await expect(handler(federated)).rejects.toBeInstanceOf(SignupNotAllowedError);
    expect(mockedGetUserByEmail).not.toHaveBeenCalled();
  });

  it('blocks an allowlisted email that is already claimed (email lock still applies)', async () => {
    process.env.SIGNUP_MODE = 'invite';
    process.env.BETA_ALLOWLIST = 'alice@example.com';
    mockedGetUserByEmail.mockResolvedValue({
      userId: 'existing-sub',
      email: 'alice@example.com',
      role: 'customer',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    await expect(handler(preSignUp())).rejects.toBeInstanceOf(EmailLockedError);
  });

  it('allows an allowlisted federated sign-up and auto-confirms it', async () => {
    process.env.SIGNUP_MODE = 'invite';
    process.env.BETA_ALLOWLIST = 'alice@example.com';
    mockedGetUserByEmail.mockResolvedValue(null);

    const result = (await handler(preSignUp({ source: 'PreSignUp_ExternalProvider' }))) as PreSignUpTriggerEvent;

    expect(result.response.autoConfirmUser).toBe(true);
    expect(result.response.autoVerifyEmail).toBe(true);
  });

  it('allows all sign-ups when the mode is open, regardless of the allowlist', async () => {
    process.env.SIGNUP_MODE = 'open';
    process.env.BETA_ALLOWLIST = 'bob@example.com';
    mockedGetUserByEmail.mockResolvedValue(null);

    const result = await handler(preSignUp());

    expect(result.triggerSource).toBe('PreSignUp_SignUp');
    expect(mockedGetUserByEmail).toHaveBeenCalledWith('alice@example.com');
  });

  it('defaults to open mode when SIGNUP_MODE is unset', async () => {
    delete process.env.SIGNUP_MODE;
    process.env.BETA_ALLOWLIST = 'bob@example.com';
    mockedGetUserByEmail.mockResolvedValue(null);

    const result = await handler(preSignUp());

    expect(result.triggerSource).toBe('PreSignUp_SignUp');
  });
});

describe('PostConfirmation provisioning', () => {
  it('creates a customer user row with the sub as id', async () => {
    const result = await handler(postConfirmation());

    expect(result.triggerSource).toBe('PostConfirmation_ConfirmSignUp');
    expect(mockedCreateUser).toHaveBeenCalledTimes(1);
    const created = mockedCreateUser.mock.calls[0][0];
    expect(created.userId).toBe('sub-123');
    expect(created.email).toBe('alice@example.com');
    expect(created.role).toBe('customer');
    expect(created.createdAt).toEqual(expect.any(String));
  });

  it('provisions a customer user row after a first-time Google sign-in', async () => {
    const result = await handler(
      postConfirmation({ sub: 'google-sub-456', email: 'google@example.com' }),
    );

    expect(result.triggerSource).toBe('PostConfirmation_ConfirmSignUp');
    expect(mockedCreateUser).toHaveBeenCalledTimes(1);
    const created = mockedCreateUser.mock.calls[0][0];
    expect(created.userId).toBe('google-sub-456');
    expect(created.email).toBe('google@example.com');
    expect(created.role).toBe('customer');
  });

  it('provisions a customer user row after a first-time Apple sign-in', async () => {
    const result = await handler(
      postConfirmation({ sub: 'apple-sub-789', email: 'apple@example.com' }),
    );

    expect(result.triggerSource).toBe('PostConfirmation_ConfirmSignUp');
    expect(mockedCreateUser).toHaveBeenCalledTimes(1);
    const created = mockedCreateUser.mock.calls[0][0];
    expect(created.userId).toBe('apple-sub-789');
    expect(created.email).toBe('apple@example.com');
    expect(created.role).toBe('customer');
  });

  it('does nothing when the sub is missing', async () => {
    const result = await handler(postConfirmation({ email: 'alice@example.com' }));

    expect(result).toBeDefined();
    expect(mockedCreateUser).not.toHaveBeenCalled();
  });

  it('returns the event unchanged for unrelated triggers', async () => {
    const event = { ...shared, triggerSource: 'PostConfirmation_ConfirmForgotPassword' } as never;
    const result = await handler(event);

    expect(result).toBe(event);
    expect(mockedCreateUser).not.toHaveBeenCalled();
  });
});