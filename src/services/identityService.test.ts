import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenError, UnauthorizedError } from './errors.js';
import { getUserById } from '../data/datasources/users.js';
import { getCurrentUser } from './userService.js';
import { requireRole, toMeView } from './identityService.js';
import { User } from './model.js';

vi.mock('../data/datasources/users.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data/datasources/users.js')>();
  return {
    ...actual,
    getUserById: vi.fn(),
  };
});

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

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getCurrentUser', () => {
  it('resolves the Users row for an authenticated sub', async () => {
    mockedGetUserById.mockResolvedValue(customerUser);

    const user = await getCurrentUser('sub-alice');

    expect(user).toEqual(customerUser);
    expect(mockedGetUserById).toHaveBeenCalledWith('sub-alice');
  });

  it('throws 401 Unauthorized when no Users row exists for the sub', async () => {
    mockedGetUserById.mockResolvedValue(null);

    await expect(getCurrentUser('sub-ghost')).rejects.toThrow(UnauthorizedError);
  });
});

describe('requireRole', () => {
  it('allows a user through when the role matches', () => {
    expect(requireRole(adminUser, 'admin')).toEqual(adminUser);
  });

  it('rejects a customer with ForbiddenError for an admin route', () => {
    expect(() => requireRole(customerUser, 'admin')).toThrow(ForbiddenError);
  });
});

describe('toMeView', () => {
  it('maps the Users row to the /v1/me response shape', () => {
    expect(toMeView(customerUser)).toEqual({
      sub: 'sub-alice',
      email: 'alice@example.com',
      role: 'customer',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  });
});