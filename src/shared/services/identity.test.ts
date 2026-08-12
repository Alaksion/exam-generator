import { describe, it, expect, vi, beforeEach } from 'vitest';
import { APIGatewayProxyEvent } from 'aws-lambda';
import { ForbiddenError, UnauthorizedError } from '../errors.js';
import { getUserById } from '../repositories/users.js';
import { getCallerSub, requireSub, getCurrentUser, requireRole, toMeResponse } from './identity.js';
import { User } from '../types.js';

vi.mock('../repositories/users.js', () => ({
  getUserById: vi.fn(),
}));

const mockedGetUserById = vi.mocked(getUserById);

const customerUser: User = {
  userId: 'sub-alice',
  email: 'alice@example.com',
  role: 'customer',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const adminUser: User = {
  ...customerUser,
  userId: 'sub-admin',
  email: 'admin@example.com',
  role: 'admin',
};

function eventWithSub(sub?: string): APIGatewayProxyEvent {
  return {
    requestContext: {
      authorizer: { claims: sub ? { sub } : {} },
    },
  } as unknown as APIGatewayProxyEvent;
}

beforeEach(() => {
  vi.clearAllMocks();
});

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

  it('throws 401 Unauthorized when no sub is present', () => {
    expect(() => requireSub(eventWithSub())).toThrow(UnauthorizedError);
    expect(() => requireSub(eventWithSub())).toThrow(expect.objectContaining({ statusCode: 401 }));
  });
});

describe('getCurrentUser', () => {
  it('resolves the Users row for an authenticated sub', async () => {
    mockedGetUserById.mockResolvedValue(customerUser);

    await expect(getCurrentUser(eventWithSub('sub-alice'))).resolves.toEqual(customerUser);
    expect(mockedGetUserById).toHaveBeenCalledWith('sub-alice');
  });

  it('throws 401 Unauthorized when the sub is missing', async () => {
    await expect(getCurrentUser(eventWithSub())).rejects.toThrow(
      expect.objectContaining({ statusCode: 401 }),
    );
    expect(mockedGetUserById).not.toHaveBeenCalled();
  });

  it('throws 401 Unauthorized when no Users row exists for the sub', async () => {
    mockedGetUserById.mockResolvedValue(null);

    await expect(getCurrentUser(eventWithSub('sub-ghost'))).rejects.toThrow(
      expect.objectContaining({ statusCode: 401 }),
    );
  });
});

describe('requireRole', () => {
  it('allows a user through when the role matches', () => {
    expect(requireRole(adminUser, 'admin')).toEqual(adminUser);
  });

  it('rejects a customer with 403 Forbidden for an admin route', () => {
    expect(() => requireRole(customerUser, 'admin')).toThrow(ForbiddenError);
    expect(() => requireRole(customerUser, 'admin')).toThrow(
      expect.objectContaining({ statusCode: 403 }),
    );
  });
});

describe('toMeResponse', () => {
  it('maps the Users row to the /v1/me response shape', () => {
    expect(toMeResponse(customerUser)).toEqual({
      sub: 'sub-alice',
      email: 'alice@example.com',
      role: 'customer',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  });
});