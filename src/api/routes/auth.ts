import { Router, jsonResponse, parseBody } from '../../shared/router.js';
import { requestPasswordReset, ForgotPasswordRequest } from '../../shared/services/passwordReset.js';
import { getCurrentUser, toMeResponse } from '../../shared/services/identity.js';

export function registerAuthRoutes(router: Router): void {
  router.register('POST', '/v1/auth/forgot-password', async (event) => {
    // A malformed email is rejected as InvalidRequest before the proxy: this is a
    // syntactic format check, not an existence oracle, so it does not leak whether
    // an account exists. Well-formed but non-existent emails still get 200 ok.
    const { email } = ForgotPasswordRequest.parse(parseBody(event));
    const result = await requestPasswordReset(email);
    return jsonResponse(200, result);
  });

  router.register('GET', '/v1/me', async (event) => {
    const user = await getCurrentUser(event);
    return jsonResponse(200, toMeResponse(user));
  });
}