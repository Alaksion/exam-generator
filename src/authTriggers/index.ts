import {
  PostConfirmationConfirmSignUpTriggerEvent,
  PreSignUpTriggerEvent,
} from 'aws-lambda';
import { enforceEmailLock, provisionUser } from '../services/signupService.js';

type TriggerEvent = PreSignUpTriggerEvent | PostConfirmationConfirmSignUpTriggerEvent;

function emailFromRequest(event: TriggerEvent): string | undefined {
  return event.request.userAttributes?.email;
}

export const handler = async (event: TriggerEvent): Promise<TriggerEvent> => {
  switch (event.triggerSource) {
    case 'PreSignUp_SignUp':
    case 'PreSignUp_ExternalProvider':
    case 'PreSignUp_AdminCreateUser':
      return enforceEmailLockHandler(event);
    case 'PostConfirmation_ConfirmSignUp':
      return provisionUserHandler(event);
    default:
      return event;
  }
};

async function enforceEmailLockHandler(event: PreSignUpTriggerEvent): Promise<PreSignUpTriggerEvent> {
  const email = emailFromRequest(event);
  await enforceEmailLock(email);
  return applyFederatedAutoConfirm(event);
}

function applyFederatedAutoConfirm(event: PreSignUpTriggerEvent): PreSignUpTriggerEvent {
  if (event.triggerSource === 'PreSignUp_ExternalProvider') {
    event.response.autoConfirmUser = true;
    event.response.autoVerifyEmail = true;
  }
  return event;
}

async function provisionUserHandler(
  event: PostConfirmationConfirmSignUpTriggerEvent,
): Promise<PostConfirmationConfirmSignUpTriggerEvent> {
  const sub = event.request.userAttributes.sub;
  const email = emailFromRequest(event);
  if (!sub || !email) {
    return event;
  }

  await provisionUser(sub, email);

  return event;
}