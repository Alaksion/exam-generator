import {
  PostConfirmationConfirmSignUpTriggerEvent,
  PreSignUpTriggerEvent,
} from 'aws-lambda';
import { createUser, getUserByEmail, normalizeEmail } from '../shared/repositories/users.js';

type TriggerEvent = PreSignUpTriggerEvent | PostConfirmationConfirmSignUpTriggerEvent;

export class EmailLockedError extends Error {
  constructor() {
    super('The email is already in use.');
    this.name = 'EmailLockedError';
  }
}

export class SignupNotAllowedError extends Error {
  constructor() {
    super('Sign-ups are currently invite-only.');
    this.name = 'SignupNotAllowedError';
  }
}

function emailFromRequest(event: TriggerEvent): string | undefined {
  return event.request.userAttributes?.email;
}

function isInviteOnly(): boolean {
  return (process.env.SIGNUP_MODE || 'open') === 'invite';
}

function allowlist(): Set<string> {
  return new Set(
    (process.env.BETA_ALLOWLIST || '')
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0),
  );
}

function isAllowed(email: string): boolean {
  if (!isInviteOnly()) {
    return true;
  }
  const normalized = normalizeEmail(email);
  const domain = normalized.split('@')[1];
  const entries = allowlist();
  return entries.has(normalized) || (domain !== undefined && entries.has(domain));
}

export const handler = async (event: TriggerEvent): Promise<TriggerEvent> => {
  switch (event.triggerSource) {
    case 'PreSignUp_SignUp':
    case 'PreSignUp_ExternalProvider':
    case 'PreSignUp_AdminCreateUser':
      return enforceEmailLock(event);
    case 'PostConfirmation_ConfirmSignUp':
      return provisionUser(event);
    default:
      return event;
  }
};

async function enforceEmailLock(event: PreSignUpTriggerEvent): Promise<PreSignUpTriggerEvent> {
  const email = emailFromRequest(event);
  if (!email) {
    return applyFederatedAutoConfirm(event);
  }

  if (!isAllowed(email)) {
    throw new SignupNotAllowedError();
  }

  const existing = await getUserByEmail(email);
  if (existing) {
    throw new EmailLockedError();
  }

  return applyFederatedAutoConfirm(event);
}

function applyFederatedAutoConfirm(event: PreSignUpTriggerEvent): PreSignUpTriggerEvent {
  if (event.triggerSource === 'PreSignUp_ExternalProvider') {
    event.response.autoConfirmUser = true;
    event.response.autoVerifyEmail = true;
  }
  return event;
}

async function provisionUser(event: PostConfirmationConfirmSignUpTriggerEvent): Promise<PostConfirmationConfirmSignUpTriggerEvent> {
  const sub = event.request.userAttributes.sub;
  const email = emailFromRequest(event);
  if (!sub || !email) {
    return event;
  }

  const result = await createUser({
    userId: sub,
    email: normalizeEmail(email),
    role: 'customer',
    createdAt: new Date().toISOString(),
  });

  if (result === 'exists') {
    const existing = await getUserByEmail(email);
    if (existing && existing.userId !== sub) {
      throw new EmailLockedError();
    }
  }

  return event;
}