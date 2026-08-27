import { APIGatewayProxyEvent } from 'aws-lambda';
import { Router } from '../router.js';
import { jsonResponse, parseBody } from '../responses.js';
import { requireSub, toListResponse } from './helpers.js';
import {
  toCertificationDto,
  toExamDownloadDto,
  toExamStatusDto,
  toFullExamDto,
  toExamListQuery,
  toUpdateCertificationInput,
  toCreateCertificationInput,
} from '../mappers.js';
import { createCertification, updateCertificationById } from '../../services/certificationService.js';
import { getCurrentUser, listUsers, updateUserRole } from '../../services/userService.js';
import { requireRole } from '../../services/identityService.js';
import {
  deleteExam,
  getDownload,
  getExamOrThrow,
  getFullExam,
  listExams,
} from '../../services/examService.js';
import { NotFoundError, InvalidRequestError } from '../../services/errors.js';
import type { Exam, ExamStatusView } from '../../services/model.js';
import {
  AdminUserListQuery,
  CreateCertificationRequest,
  ExamListQuery,
  UpdateCertificationRequest,
  UpdateUserRoleRequest,
} from '../model.js';

const IMMUTABLE_FIELDS = ['provider', 'code'] as const;

async function requireAdmin(event: APIGatewayProxyEvent): Promise<void> {
  const sub = requireSub(event);
  const user = await getCurrentUser(sub);
  requireRole(user, 'admin');
}

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
    const { items, nextCursor } = await listUsers(query);
    return toListResponse(items, nextCursor);
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
    const input = CreateCertificationRequest.parse(parseBody(event));
    const certification = await createCertification(toCreateCertificationInput(input));
    return jsonResponse(201, toCertificationDto(certification));
  });

  router.register('PUT', '/v1/admin/certifications/{id}', async (event, params) => {
    await requireAdmin(event);
    const body = parseBody(event);
    assertImmutable(body);
    const input = UpdateCertificationRequest.parse(body);
    const certification = await updateCertificationById(params.id, toUpdateCertificationInput(input));
    return jsonResponse(200, toCertificationDto(certification));
  });

  router.register('GET', '/v1/admin/exams', async (event) => {
    await requireAdmin(event);
    const query = parseExamQuery(event);
    const { items, nextCursor } = await listExams(query);
    return toListResponse(items, nextCursor);
  });

  router.register('GET', '/v1/admin/exams/{id}', async (event, params) => {
    await requireAdmin(event);
    const exam = await getExamOrThrow(params.id);
    const fullExam = await getFullExam(exam);
    return jsonResponse(200, toFullExamDto(fullExam));
  });

  router.register('GET', '/v1/admin/exams/{id}/status', async (event, params) => {
    await requireAdmin(event);
    const exam = await getExamOrThrow(params.id);
    return jsonResponse(200, toExamStatusDto(toStatusView(exam)));
  });

  router.register('GET', '/v1/admin/exams/{id}/download', async (event, params) => {
    await requireAdmin(event);
    const exam = await getExamOrThrow(params.id);
    const download = await getDownload(exam);
    return jsonResponse(200, toExamDownloadDto(download));
  });

  router.register('DELETE', '/v1/admin/exams/{id}', async (event, params) => {
    await requireAdmin(event);
    const exam = await getExamOrThrow(params.id);
    await deleteExam(exam);
    return { statusCode: 204, body: '' };
  });
}

function assertImmutable(body: unknown): void {
  const record = body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  if (IMMUTABLE_FIELDS.some((field) => field in record)) {
    throw new InvalidRequestError(`${IMMUTABLE_FIELDS.join(' and ')} are immutable.`);
  }
}

function parseExamQuery(event: APIGatewayProxyEvent): ReturnType<typeof toExamListQuery> {
  return toExamListQuery(
    ExamListQuery.parse(
      Object.fromEntries(
        new URLSearchParams(
          (event.queryStringParameters as Record<string, string> | undefined) ?? {},
        ),
      ),
    ),
  );
}

function toStatusView(exam: Exam): ExamStatusView {
  return {
    id: exam.id,
    status: exam.status,
    createdAt: exam.createdAt,
    finishedAt: exam.finishedAt,
  };
}