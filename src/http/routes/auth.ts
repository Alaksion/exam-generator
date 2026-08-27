import { Router } from '../router.js';
import { jsonResponse, parseBody } from '../responses.js';
import { requireSub } from './helpers.js';
import { getCurrentUser } from '../../services/userService.js';
import { toMeView } from '../../services/identityService.js';
import { requestPasswordReset } from '../../services/passwordResetService.js';
import { ForgotPasswordRequest } from '../model.js';

export function registerAuthRoutes(router: Router): void {
  router.register('POST', '/v1/auth/forgot-password', async (event) => {
    const { email } = ForgotPasswordRequest.parse(parseBody(event));
    const result = await requestPasswordReset(email);
    return jsonResponse(200, result);
  });

  router.register('GET', '/v1/me', async (event) => {
    const sub = requireSub(event);
    const user = await getCurrentUser(sub);
    return jsonResponse(200, toMeView(user));
  });
}