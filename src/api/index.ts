import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';
import { Router, jsonResponse, notFound, parseBody, getQueryParam } from '../shared/router.js';
import { createCertification, updateCertificationById, toPublicCertification } from '../shared/services/certification.js';
import { isApiError, NotFoundError } from '../shared/errors.js';
import { listCertifications, getCertificationById } from '../shared/repositories/certifications.js';

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
  const body = parseBody(event) as Record<string, unknown>;
  return jsonResponse(202, {
    id: 'exam-uuid',
    certificationId: body.certificationId as string,
    status: 'GENERATING',
  });
});

router.register('GET', '/v1/exams', async (event) => {
  return jsonResponse(200, {
    items: [],
    nextCursor: getQueryParam(event, 'cursor'),
  });
});

router.register('GET', '/v1/exams/{id}', async (_event, params) => {
  return jsonResponse(200, { id: params.id, status: 'READY', title: 'Stub Exam' });
});

router.register('GET', '/v1/exams/{id}/status', async (_event, params) => {
  return jsonResponse(200, { id: params.id, status: 'READY' });
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
