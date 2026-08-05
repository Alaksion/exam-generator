import { describe, it, expect, vi, beforeEach } from 'vitest';
import { APIGatewayRequestAuthorizerEvent } from 'aws-lambda';
import { handler } from './index.js';

vi.mock('./apiKey.js', () => ({
  fetchExpectedKey: vi.fn(),
}));

import { fetchExpectedKey } from './apiKey.js';

const mockedFetchExpectedKey = vi.mocked(fetchExpectedKey);

function makeEvent(headers: Record<string, string> = {}): APIGatewayRequestAuthorizerEvent {
  return {
    type: 'REQUEST',
    methodArn: 'arn:aws:execute-api:us-east-1:123456789:abc123/dev/GET/v1/health',
    resource: '/v1/health',
    path: '/v1/health',
    httpMethod: 'GET',
    headers,
    multiValueHeaders: {},
    queryStringParameters: {},
    multiValueQueryStringParameters: {},
    pathParameters: {},
    stageVariables: {},
    requestContext: {} as never,
  };
}

describe('authorizer handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedFetchExpectedKey.mockResolvedValue({ ok: true, key: 'secret-key' });
  });

  it('allows the request when the x-api-key header matches', async () => {
    const result = await handler(makeEvent({ 'x-api-key': 'secret-key' }));

    expect(result.principalId).toBe('user');
    expect(result.policyDocument.Statement).toHaveLength(1);
    expect(result.policyDocument.Statement[0]).toMatchObject({
      Effect: 'Allow',
      Action: 'execute-api:Invoke',
      Resource: 'arn:aws:execute-api:us-east-1:123456789:abc123/dev/GET/v1/health',
    });
  });

  it('rejects the request when the header is missing', async () => {
    await expect(handler(makeEvent())).rejects.toThrow('Unauthorized');
  });

  it('rejects the request when the header value is invalid', async () => {
    await expect(handler(makeEvent({ 'x-api-key': 'wrong-key' }))).rejects.toThrow('Unauthorized');
  });
});
