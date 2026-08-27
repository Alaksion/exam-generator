import { APIGatewayProxyEvent } from 'aws-lambda';
import { z } from 'zod';
import { Router, jsonResponse, parseBody } from '../../shared/router.js';
import { NotFoundError } from '../../shared/errors.js';
import { Role } from '../../shared/types.js';
import {
  createCertification,
  updateCertificationById,
  toPublicCertification,
} from '../../shared/services/certification.js';
import { getCurrentUser, requireRole } from '../../shared/services/identity.js';
import { listUsers, updateUserRole } from '../../shared/repositories/users.js';
import { listExams } from '../../shared/repositories/exams.js';
import { toListResponse } from './helpers.js';
import {
  parseExamListQuery,
  getExamOrThrow,
  toFullExamResponse,
  toStatusResponse,
  toDownloadResponse,
  deleteExamAndRespond,
} from './exam-helpers.js';

async function requireAdmin(event: APIGatewayProxyEvent): Promise<void> {
  const user = await getCurrentUser(event);
  requireRole(user, 'admin');
}

const AdminUserListQuery = z.object({
  email: z.string().min(1).optional(),
  sub: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
});

const UpdateUserRoleRequest = z.object({ role: Role });

export function registerAdminRoutes(router: Router): void {
  router.register('GET', '/v1/admin/users', async (event) => {
    await requireAdmin(event);
    const query = AdminUserListQuery.parse(
      Object.fromEntries(
        new URLSearchParams(
          (event.queryStringParameters as Record<string, string> | undefined) ?? {},
        ),
      ),
    );
    const { users, nextCursor } = await listUsers(query);
    return toListResponse(users, nextCursor);
  });

  router.register('PUT', '/v1/admin/users/{id}/role', async (event, params) => {
    await requireAdmin(event);
    const { role } = UpdateUserRoleRequest.parse(parseBody(event));
    const user = await updateUserRole(params.id, role);
    if (!user) {
      throw new NotFoundError('User');
    }
    return jsonResponse(200, user);
  });

  router.register('POST', '/v1/admin/certifications', async (event) => {
    await requireAdmin(event);
    const body = parseBody(event);
    const certification = await createCertification(body);
    return jsonResponse(201, toPublicCertification(certification));
  });

  router.register('PUT', '/v1/admin/certifications/{id}', async (event, params) => {
    await requireAdmin(event);
    const body = parseBody(event);
    const certification = await updateCertificationById(params.id, body);
    return jsonResponse(200, toPublicCertification(certification));
  });

  router.register('GET', '/v1/admin/exams', async (event) => {
    await requireAdmin(event);
    const query = parseExamListQuery(event);
    const { exams, nextCursor } = await listExams(query);
    return toListResponse(exams, nextCursor);
  });

  router.register('GET', '/v1/admin/exams/{id}', async (event, params) => {
    await requireAdmin(event);
    const exam = await getExamOrThrow(params.id);
    return toFullExamResponse(exam);
  });

  router.register('GET', '/v1/admin/exams/{id}/status', async (event, params) => {
    await requireAdmin(event);
    const exam = await getExamOrThrow(params.id);
    return toStatusResponse(exam);
  });

  router.register('GET', '/v1/admin/exams/{id}/download', async (event, params) => {
    await requireAdmin(event);
    const exam = await getExamOrThrow(params.id);
    return toDownloadResponse(exam);
  });

  router.register('DELETE', '/v1/admin/exams/{id}', async (event, params) => {
    await requireAdmin(event);
    const exam = await getExamOrThrow(params.id);
    return deleteExamAndRespond(exam);
  });
}