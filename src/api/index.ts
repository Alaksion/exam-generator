import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { z } from 'zod';
import { Router, jsonResponse, notFound } from '../shared/router.js';
import { buildCorsHeaders } from '../shared/cors.js';
import { isApiError } from '../shared/errors.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerCertificationRoutes } from './routes/certifications.js';
import { registerExamRoutes } from './routes/exams.js';
import { registerAdminRoutes } from './routes/admin.js';

const router = new Router();

router.register('GET', '/v1/health', async () => {
  console.log('Health check endpoint called.');
  return jsonResponse(200, { status: 'ok' });
});

registerAuthRoutes(router);
registerCertificationRoutes(router);
registerExamRoutes(router);
registerAdminRoutes(router);

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