import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { z } from 'zod';
import { Router, jsonResponse, notFound, parseBody } from '../shared/router.js';
import { buildCorsHeaders } from '../shared/cors.js';
import {
  createCertification,
  updateCertificationById,
  toPublicCertification,
} from '../shared/services/certification.js';
import { isApiError, NotFoundError, ExamNotReadyError } from '../shared/errors.js';
import { listCertifications, getCertificationById } from '../shared/repositories/certifications.js';
import { listExams } from '../shared/repositories/exams.js';
import {
  getCanonicalExam,
  getPresignedDownloadUrl,
  deleteArtifacts,
} from '../shared/repositories/artifacts.js';
import { getExamById, deleteExam } from '../shared/repositories/exams.js';
import {
  requestExamGeneration,
  toCreatedExamResponse,
  RequestExamGeneration,
} from '../shared/services/examGeneration.js';
import { requestPasswordReset, ForgotPasswordRequest } from '../shared/services/passwordReset.js';
import { getCurrentUser, requireRole, toMeResponse } from '../shared/services/identity.js';
import { Exam, Provider, ExamStatus, User } from '../shared/types.js';

const router = new Router();

async function requireAdmin(event: APIGatewayProxyEvent): Promise<User> {
  const user = await getCurrentUser(event);
  requireRole(user, 'admin');
  return user;
}

router.register('GET', '/v1/health', async () => {
  console.log('Health check endpoint called.');
  return jsonResponse(200, { status: 'ok' });
});

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

router.register('POST', '/v1/certifications', async (event) => {
  const body = parseBody(event);
  const certification = await createCertification(body);
  return jsonResponse(201, toPublicCertification(certification));
});

router.register('GET', '/v1/certifications', async () => {
  const certifications = await listCertifications();
  return jsonResponse(200, { items: certifications.map(toPublicCertification) });
});

router.register('GET', '/v1/certifications/{id}', async (_event, params) => {
  const certification = await getCertificationById(params.id);
  if (!certification) {
    throw new NotFoundError('Certification');
  }
  return jsonResponse(200, toPublicCertification(certification));
});

router.register('PUT', '/v1/certifications/{id}', async (event, params) => {
  const body = parseBody(event);
  const certification = await updateCertificationById(params.id, body);
  return jsonResponse(200, toPublicCertification(certification));
});

router.register('POST', '/v1/exams', async (event) => {
  const body = RequestExamGeneration.parse(parseBody(event));
  const user = await getCurrentUser(event);
  const exam = await requestExamGeneration(body.certificationId, user.userId);
  return jsonResponse(201, toCreatedExamResponse(exam));
});

const ExamListQuery = z.object({
  status: ExamStatus.default('READY'),
  provider: Provider.optional(),
  certificationId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
});
type ExamListQuery = z.infer<typeof ExamListQuery>;

function parseExamListQuery(event: APIGatewayProxyEvent): ExamListQuery {
  return ExamListQuery.parse(
    Object.fromEntries(
      new URLSearchParams(
        (event.queryStringParameters as Record<string, string> | undefined) ?? {},
      ),
    ),
  );
}

function toListResponse<T>(items: T[], nextCursor?: string): APIGatewayProxyResult {
  return jsonResponse(200, {
    items,
    cursor: {
      nextCursor: nextCursor ?? null,
      hasNextPage: Boolean(nextCursor),
    },
  });
}

router.register('GET', '/v1/exams', async (event) => {
  const user = await getCurrentUser(event);
  const query = parseExamListQuery(event);
  const { exams, nextCursor } = await listExams({ ...query, ownerId: user.userId });
  return toListResponse(exams, nextCursor);
});

router.register('GET', '/v1/admin/exams', async (event) => {
  await requireAdmin(event);
  const query = parseExamListQuery(event);
  const { exams, nextCursor } = await listExams(query);
  return toListResponse(exams, nextCursor);
});

async function loadExamOrThrow(id: string, ownerId?: string): Promise<Exam> {
  const exam = await getExamById(id);
  if (!exam || (ownerId !== undefined && exam.ownerId !== ownerId)) {
    throw new NotFoundError('Exam');
  }
  return exam;
}

async function toFullExamResponse(exam: Exam): Promise<APIGatewayProxyResult> {
  if (exam.status !== 'READY' || !exam.s3KeyJson) {
    throw new ExamNotReadyError();
  }
  const fullExam = await getCanonicalExam(exam.s3KeyJson);
  return jsonResponse(200, fullExam);
}

function toStatusResponse(exam: Exam): APIGatewayProxyResult {
  return jsonResponse(200, {
    id: exam.id,
    status: exam.status,
    createdAt: exam.createdAt,
    finishedAt: exam.finishedAt,
  });
}

async function toDownloadResponse(exam: Exam): Promise<APIGatewayProxyResult> {
  if (exam.status !== 'READY' || !exam.s3KeyPdf) {
    throw new ExamNotReadyError();
  }
  const { url, expiresAt } = await getPresignedDownloadUrl(exam.s3KeyPdf);
  return jsonResponse(200, { downloadUrl: url, expiresAt });
}

async function toDeleteResponse(exam: Exam): Promise<APIGatewayProxyResult> {
  const s3Keys = [exam.s3KeyJson, exam.s3KeyPdf].filter((key): key is string => Boolean(key));
  if (s3Keys.length > 0) {
    await deleteArtifacts(s3Keys);
  }
  await deleteExam(exam.id);
  return { statusCode: 204, body: '' };
}

router.register('GET', '/v1/exams/{id}', async (event, params) => {
  const user = await getCurrentUser(event);
  const exam = await loadExamOrThrow(params.id, user.userId);
  return toFullExamResponse(exam);
});

router.register('GET', '/v1/admin/exams/{id}', async (event, params) => {
  await requireAdmin(event);
  const exam = await loadExamOrThrow(params.id);
  return toFullExamResponse(exam);
});

router.register('GET', '/v1/exams/{id}/status', async (event, params) => {
  const user = await getCurrentUser(event);
  const exam = await loadExamOrThrow(params.id, user.userId);
  return toStatusResponse(exam);
});

router.register('GET', '/v1/admin/exams/{id}/status', async (event, params) => {
  await requireAdmin(event);
  const exam = await loadExamOrThrow(params.id);
  return toStatusResponse(exam);
});

router.register('GET', '/v1/exams/{id}/download', async (event, params) => {
  const user = await getCurrentUser(event);
  const exam = await loadExamOrThrow(params.id, user.userId);
  return toDownloadResponse(exam);
});

router.register('GET', '/v1/admin/exams/{id}/download', async (event, params) => {
  await requireAdmin(event);
  const exam = await loadExamOrThrow(params.id);
  return toDownloadResponse(exam);
});

router.register('DELETE', '/v1/exams/{id}', async (event, params) => {
  const user = await getCurrentUser(event);
  const exam = await loadExamOrThrow(params.id, user.userId);
  return toDeleteResponse(exam);
});

router.register('DELETE', '/v1/admin/exams/{id}', async (event, params) => {
  await requireAdmin(event);
  const exam = await loadExamOrThrow(params.id);
  return toDeleteResponse(exam);
});

function mapErrorToResponse(error: unknown): APIGatewayProxyResult {
  if (isApiError(error)) {
    return jsonResponse(error.statusCode, error.toResponse());
  }

  if (error instanceof z.ZodError) {
    const message = error.errors
      .map((issue) => `${issue.path.length ? issue.path.join('.') : 'request'}: ${issue.message}`)
      .join('; ');
    return jsonResponse(400, { error: 'InvalidRequest', message });
  }

  console.error('Unhandled error', error);
  return jsonResponse(500, { error: 'InternalError', message: 'An internal error occurred.' });
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const corsHeaders = buildCorsHeaders(event.headers?.Origin ?? event.headers?.origin);

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: corsHeaders,
      body: '',
    };
  }

  try {
    const result = await router.route(event);
    return withCors(result ?? notFound(), corsHeaders);
  } catch (error) {
    return withCors(mapErrorToResponse(error), corsHeaders);
  }
};

function withCors(
  result: APIGatewayProxyResult,
  corsHeaders: Record<string, string>,
): APIGatewayProxyResult {
  if (Object.keys(corsHeaders).length === 0) {
    return result;
  }
  return {
    ...result,
    headers: {
      ...result.headers,
      ...corsHeaders,
    },
  };
}
