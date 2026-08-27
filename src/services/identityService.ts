import { ForbiddenError } from './errors.js';
import { type MeView, type Role, type User } from './model.js';

export function requireRole(user: User, role: Role): User {
  if (user.role !== role) {
    throw new ForbiddenError(`Requires the ${role} role.`);
  }
  return user;
}

export function toMeView(user: User): MeView {
  return {
    sub: user.userId,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
  };
}