import {
  createUser as createUserRecord,
  getUserByEmail as getRecordByEmail,
  getUserById as getRecordById,
  listUsers as listUserRecords,
  normalizeEmail,
  updateUserRole as updateRecordRole,
  type ListUsersFilters,
} from '../data/datasources/users.js';
import { type UserRecord } from '../data/model.js';
import { UnauthorizedError } from './errors.js';
import { type ListResult, type Role, type User } from './model.js';

export function mapUserRecordToUser(record: UserRecord): User {
  return {
    userId: record.userId,
    email: record.email,
    role: record.role,
    createdAt: record.createdAt,
  };
}

export async function getCurrentUser(sub: string): Promise<User> {
  const record = await getRecordById(sub);
  if (!record) {
    throw new UnauthorizedError('No account found for this identity.');
  }
  return mapUserRecordToUser(record);
}

export async function getUserById(userId: string): Promise<User | null> {
  const record = await getRecordById(userId);
  return record ? mapUserRecordToUser(record) : null;
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const record = await getRecordByEmail(email);
  return record ? mapUserRecordToUser(record) : null;
}

export async function listUsers(
  filters: ListUsersFilters,
): Promise<ListResult<User>> {
  const { users, nextCursor } = await listUserRecords(filters);
  return { items: users.map(mapUserRecordToUser), nextCursor };
}

export async function createUser(user: User): Promise<'created' | 'exists'> {
  return createUserRecord({
    userId: user.userId,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
  });
}

export async function updateUserRole(userId: string, role: Role): Promise<User | null> {
  const record = await updateRecordRole(userId, role);
  return record ? mapUserRecordToUser(record) : null;
}

export { normalizeEmail };