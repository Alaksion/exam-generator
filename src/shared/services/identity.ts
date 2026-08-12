import { APIGatewayProxyEvent } from 'aws-lambda';
import { getUserById } from '../repositories/users.js';
import { ForbiddenError, UnauthorizedError } from '../errors.js';
import { Role, User } from '../types.js';

export interface MeResponse {
  sub: string;
  email: string;
  role: Role;
  createdAt: string;
}

interface AuthorizerClaims {
  sub?: string;
}

function getAuthorizerClaims(event: APIGatewayProxyEvent): AuthorizerClaims | undefined {
  const authorizer = event.requestContext?.authorizer as unknown as
    | { claims?: AuthorizerClaims }
    | undefined;
  return authorizer?.claims;
}

export function getCallerSub(event: APIGatewayProxyEvent): string | undefined {
  return getAuthorizerClaims(event)?.sub;
}

export function requireSub(event: APIGatewayProxyEvent): string {
  const sub = getCallerSub(event);
  if (!sub) {
    throw new UnauthorizedError('Missing or invalid authentication token.');
  }
  return sub;
}

export async function getCurrentUser(event: APIGatewayProxyEvent): Promise<User> {
  const sub = requireSub(event);
  const user = await getUserById(sub);
  if (!user) {
    throw new UnauthorizedError('No account found for this identity.');
  }
  return user;
}

export function requireRole(user: User, role: Role): User {
  if (user.role !== role) {
    throw new ForbiddenError(`Requires the ${role} role.`);
  }
  return user;
}

export function toMeResponse(user: User): MeResponse {
  return {
    sub: user.userId,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
  };
}