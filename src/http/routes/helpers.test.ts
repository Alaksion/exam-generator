import { describe, it, expect } from 'vitest';
import { APIGatewayProxyEvent } from 'aws-lambda';
import { UnauthorizedError } from '../../services/errors.js';
import { getCallerSub, requireSub } from './helpers.js';

function eventWithSub(sub?: string): APIGatewayProxyEvent {
  return {
    requestContext: {
      authorizer: { claims: sub ? { sub } : {} },
    },
  } as unknown as APIGatewayProxyEvent;
}

describe('getCallerSub', () => {
  it('reads sub from the Cognito authorizer claims', () => {
    expect(getCallerSub(eventWithSub('sub-alice'))).toBe('sub-alice');
  });

  it('returns undefined when no claims are present', () => {
    expect(getCallerSub({ requestContext: {} } as unknown as APIGatewayProxyEvent)).toBeUndefined();
  });
});

describe('requireSub', () => {
  it('returns the sub when present', () => {
    expect(requireSub(eventWithSub('sub-alice'))).toBe('sub-alice');
  });

  it('throws UnauthorizedError when no sub is present', () => {
    expect(() => requireSub(eventWithSub())).toThrow(UnauthorizedError);
  });
});