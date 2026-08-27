import { requestPasswordReset as resetPassword } from '../data/datasources/cognito.js';
import { type PasswordResetResult } from './model.js';

export async function requestPasswordReset(email: string): Promise<PasswordResetResult> {
  const delayMs = randomizedDelay();
  await resetPassword(email);
  await sleep(delayMs);
  return { status: 'ok' };
}

function randomizedDelay(): number {
  return 400 + Math.floor(Math.random() * 400);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}