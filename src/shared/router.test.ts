import { describe, it, expect } from 'vitest';
import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { Router, jsonResponse, notFound } from './router.js';

function makeEvent(method: string, path: string): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: `${method} ${path}`,
    rawPath: path,
    rawQueryString: '',
    headers: {},
    requestContext: {
      accountId: '123456789',
      apiId: 'api',
      domainName: 'localhost',
      domainPrefix: 'localhost',
      http: { method, path, protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'test' },
      requestId: 'req-1',
      routeKey: `${method} ${path}`,
      stage: 'test',
      time: '01/Jan/2024:00:00:00 +0000',
      timeEpoch: 1704067200000,
    },
  } as APIGatewayProxyEventV2;
}

describe('Router', () => {
  it('routes a matching request', async () => {
    const router = new Router();
    router.register('GET', '/v1/exams', async () => jsonResponse(200, { items: [] }));

    const result = await router.route(makeEvent('GET', '/v1/exams'));
    expect(result).toEqual(jsonResponse(200, { items: [] }));
  });

  it('returns null when no route matches', async () => {
    const router = new Router();
    const result = await router.route(makeEvent('GET', '/v1/unknown'));
    expect(result).toBeNull();
  });
});

describe('notFound', () => {
  it('returns a 404 JSON response', () => {
    expect(notFound()).toEqual({
      statusCode: 404,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'NotFound',
        message: 'The requested resource was not found.',
      }),
    });
  });
});
