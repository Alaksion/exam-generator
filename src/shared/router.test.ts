import { describe, it, expect } from 'vitest';
import { APIGatewayProxyEvent } from 'aws-lambda';
import { Router, jsonResponse, notFound } from './router.js';

function makeEvent(method: string, path: string): APIGatewayProxyEvent {
  return {
    httpMethod: method,
    path,
    headers: {},
    queryStringParameters: null,
    body: null,
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEvent;
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
