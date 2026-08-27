import {
  CognitoIdentityProviderClient,
  ForgotPasswordCommand,
  UserNotFoundException,
} from '@aws-sdk/client-cognito-identity-provider';
import { config } from '../../shared/config.js';

const cognito = new CognitoIdentityProviderClient({});

export async function requestPasswordReset(email: string): Promise<void> {
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
}