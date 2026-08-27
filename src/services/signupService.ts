import { config } from '../shared/config.js';
import { normalizeEmail, createUser, getUserByEmail } from './userService.js';
import { DomainError } from './errors.js';

export class EmailLockedError extends DomainError {
  constructor() {
    super('The email is already in use.');
    this.name = 'EmailLockedError';
  }
}

export class SignupNotAllowedError extends DomainError {
  constructor() {
    super('Sign-ups are currently invite-only.');
    this.name = 'SignupNotAllowedError';
  }
}

export function isSignupAllowed(email: string | undefined): boolean {
  if (config.signupMode !== 'invite') {
    return true;
  }
  if (!email) {
    return false;
  }
  const normalized = normalizeEmail(email);
  const domain = normalized.split('@')[1];
  const entries = config.betaAllowlist;
  return entries.has(normalized) || (domain !== undefined && entries.has(domain));
}

export async function enforceEmailLock(email: string | undefined): Promise<void> {
  if (!isSignupAllowed(email)) {
    throw new SignupNotAllowedError();
  }

  if (!email) {
    return;
  }

  const existing = await getUserByEmail(email);
  if (existing) {
    throw new EmailLockedError();
  }
}

export async function provisionUser(sub: string, email: string): Promise<void> {
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
}