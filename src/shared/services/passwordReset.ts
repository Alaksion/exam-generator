import {
  CognitoIdentityProviderClient,
  ForgotPasswordCommand,
  UserNotFoundException,
} from '@aws-sdk/client-cognito-identity-provider';
import { config } from '../config.js';
import { z } from 'zod';

const cognito = new CognitoIdentityProviderClient({});

export const ForgotPasswordRequest = z.object({
  email: z.string().trim().toLowerCase().email(),
});
export type ForgotPasswordRequest = z.infer<typeof ForgotPasswordRequest>;

export interface PasswordResetResult {
  status: 'ok';
}

export async function requestPasswordReset(email: string): Promise<PasswordResetResult> {
  const delayMs = randomizedDelay();
  try {
    await cognito.send(
      new ForgotPasswordCommand({
        ClientId: config.cognitoUserPoolClientId,
        Username: email,
      }),
    );
  } catch (error) {
    if (!(error instanceof UserNotFoundException)) {
      throw error;
    }
  }
  await sleep(delayMs);
  return { status: 'ok' };
}

function randomizedDelay(): number {
  return 400 + Math.floor(Math.random() * 400);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}