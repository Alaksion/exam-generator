import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';
import { Router, jsonResponse, notFound, parseBody } from '../shared/router.js';
import { createCertification, updateCertificationById, toPublicCertification } from '../shared/services/certification.js';
import { isApiError, NotFoundError, ExamNotReadyError } from '../shared/errors.js';
import { listCertifications, getCertificationById } from '../shared/repositories/certifications.js';
import { listExams } from '../shared/repositories/exams.js';
import { getExamById } from '../shared/repositories/exams.js';
import { getCanonicalExam, getPresignedDownloadUrl } from '../shared/repositories/artifacts.js';
import { requestExamGeneration, toCreatedExamResponse, RequestExamGeneration } from '../shared/services/examGeneration.js';
import { Exam, Provider, ExamStatus } from '../shared/types.js';

const router = new Router();

router.register('GET', '/v1/health', async () => {
  return jsonResponse(200, { status: 'ok' });
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
  const exam = await requestExamGeneration(body.certificationId);
  return jsonResponse(201, toCreatedExamResponse(exam));
});

router.register('GET', '/v1/exams', async (event) => {
  const query = z
    .object({
      status: ExamStatus.default('READY'),
      provider: Provider.optional(),
      certificationId: z.string().uuid().optional(),
      limit: z.coerce.number().int().min(1).max(100).default(20),
      cursor: z.string().min(1).optional(),
    })
    .parse(Object.fromEntries(new URLSearchParams(event.rawQueryString)));

  const { exams, nextCursor } = await listExams(query);

  return jsonResponse(200, {
    items: exams,
    cursor: {
      nextCursor: nextCursor ?? null,
      hasNextPage: Boolean(nextCursor),
    },
  });
});

async function loadExamOrThrow(id: string): Promise<Exam> {
  const exam = await getExamById(id);
  if (!exam) {
    throw new NotFoundError('Exam');
  }
  return exam;
}

router.register('GET', '/v1/exams/{id}', async (_event, params) => {
  const exam = await loadExamOrThrow(params.id);
  if (exam.status !== 'READY') {
    throw new ExamNotReadyError();
  }
  if (!exam.s3KeyJson) {
    throw new ExamNotReadyError();
  }
  const fullExam = await getCanonicalExam(exam.s3KeyJson);
  return jsonResponse(200, fullExam);
});

router.register('GET', '/v1/exams/{id}/status', async (_event, params) => {
  const exam = await loadExamOrThrow(params.id);
  return jsonResponse(200, {
    id: exam.id,
    status: exam.status,
    createdAt: exam.createdAt,
    finishedAt: exam.finishedAt,
  });
});

router.register('GET', '/v1/exams/{id}/download', async (_event, params) => {
  const exam = await loadExamOrThrow(params.id);
  if (exam.status !== 'READY' || !exam.s3KeyPdf) {
    throw new ExamNotReadyError();
  }
  const { url, expiresAt } = await getPresignedDownloadUrl(exam.s3KeyPdf);
  return jsonResponse(200, { downloadUrl: url, expiresAt });
});

router.register('DELETE', '/v1/exams/{id}', async () => {
  return { statusCode: 204, body: '' };
});

function mapErrorToResponse(error: unknown): APIGatewayProxyResultV2 {
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

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const result = await router.route(event);
    return result ?? notFound();
  } catch (error) {
    return mapErrorToResponse(error);
  }
};
