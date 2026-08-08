import { describe, it, expect, vi, beforeEach } from 'vitest';
import { APIGatewayRequestAuthorizerEvent } from 'aws-lambda';
import { handler } from './index.js';

vi.mock('./apiKey.js', () => ({
  fetchExpectedKey: vi.fn(),
}));

import { fetchExpectedKey } from './apiKey.js';

const mockedFetchExpectedKey = vi.mocked(fetchExpectedKey);

function makeEvent(
  headers: Record<string, string> = {},
  httpMethod = 'GET',
  methodArn = 'arn:aws:execute-api:us-east-1:123456789:abc123/dev/GET/v1/health',
): APIGatewayRequestAuthorizerEvent {
  return {
    type: 'REQUEST',
    methodArn,
    resource: '/{proxy+}',
    path: methodArn.split('/')[7] ?? '/',
    httpMethod,
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

  it('allows an OPTIONS preflight without an API key (verb from methodArn)', async () => {
    const result = await handler(
      makeEvent({}, 'ANY', 'arn:aws:execute-api:us-east-1:123456789:abc123/dev/OPTIONS/v1/certifications'),
    );

    expect(result.principalId).toBe('user');
    expect(result.policyDocument.Statement[0]).toMatchObject({
      Effect: 'Allow',
      Action: 'execute-api:Invoke',
      Resource: 'arn:aws:execute-api:us-east-1:123456789:abc123/dev/OPTIONS/v1/certifications',
    });
    expect(mockedFetchExpectedKey).not.toHaveBeenCalled();
  });

  it('allows an OPTIONS preflight with a direct OPTIONS httpMethod', async () => {
    const result = await handler(
      makeEvent({}, 'OPTIONS', 'arn:aws:execute-api:us-east-1:123456789:abc123/dev/OPTIONS/v1/certifications'),
    );

    expect(result.principalId).toBe('user');
    expect(result.policyDocument.Statement[0]).toMatchObject({ Effect: 'Allow' });
    expect(mockedFetchExpectedKey).not.toHaveBeenCalled();
  });

  it('rejects the request when the header is missing', async () => {
    await expect(handler(makeEvent())).rejects.toThrow('Unauthorized');
  });

  it('rejects the request when the header value is invalid', async () => {
    await expect(handler(makeEvent({ 'x-api-key': 'wrong-key' }))).rejects.toThrow('Unauthorized');
  });
});
