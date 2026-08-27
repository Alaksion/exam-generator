import { APIGatewayProxyEvent } from 'aws-lambda';
import { jsonResponse } from '../responses.js';
import { UnauthorizedError } from '../../services/errors.js';

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

export function toListResponse<T>(items: T[], nextCursor?: string) {
  return jsonResponse(200, {
    items,
    cursor: {
      nextCursor: nextCursor ?? null,
      hasNextPage: Boolean(nextCursor),
    },
  });
}