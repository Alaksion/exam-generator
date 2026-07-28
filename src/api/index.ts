import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { Router, jsonResponse, notFound, parseBody, getQueryParam } from '../shared/router.js';

const router = new Router();

router.register('POST', '/v1/certifications', async (event) => {
  const body = parseBody(event) as Record<string, unknown>;
  const config = (body.config as Record<string, unknown>) ?? {};
  return jsonResponse(201, {
    id: 'cert-uuid',
    ...body,
    config: { ...config, promptTemplate: undefined },
  });
});

router.register('GET', '/v1/certifications', async () => {
  return jsonResponse(200, { items: [], nextCursor: undefined });
});

router.register('GET', '/v1/certifications/{id}', async (_event, params) => {
  return jsonResponse(200, { id: params.id, provider: 'aws', code: 'CLF-C02', name: 'Stub' });
});

router.register('PUT', '/v1/certifications/{id}', async (event, params) => {
  const body = parseBody(event) as Record<string, unknown>;
  return jsonResponse(200, { id: params.id, ...body });
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

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const result = await router.route(event);
  return result ?? notFound();
};
