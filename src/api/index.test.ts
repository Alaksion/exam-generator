import { describe, it, expect, vi, beforeEach } from 'vitest';
import { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { z } from 'zod';
import { ConflictError } from '../shared/errors.js';
import { handler } from './index.js';
import { createCertification } from '../shared/services/certification.js';

vi.mock('../shared/services/certification.js', () => ({
  createCertification: vi.fn(),
}));

const mockedCreateCertification = vi.mocked(createCertification);

const validCertificationInput = {
  provider: 'aws' as const,
  code: 'CLF-C02',
  name: 'AWS Certified Cloud Practitioner',
  version: 'v1',
  description: 'Entry-level AWS certification.',
  isActive: true,
  config: {
    questionCount: 10,
    difficultyDistribution: { easy: 0.2, medium: 0.5, hard: 0.3 },
    domains: ['Cloud Concepts'],
    modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
    promptTemplate: 'Generate a {difficulty} question about {domain} for exam {code}.',
  },
};

function makeEvent(method: string, path: string, body?: unknown): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: `${method} ${path}`,
    rawPath: path,
    rawQueryString: '',
    headers: {},
    body: body === undefined ? undefined : JSON.stringify(body),
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

describe('health endpoint', () => {
  it('returns 200 OK with a status payload', async () => {
    const result = (await handler(makeEvent('GET', '/v1/health'))) as APIGatewayProxyStructuredResultV2;
    const body = JSON.parse(result.body ?? '{}') as { status: string };

    expect(result.statusCode).toBe(200);
    expect(result.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(body.status).toBe('ok');
  });
});

describe('POST /v1/certifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 201 Created with the public certification', async () => {
    const created = { ...validCertificationInput, id: '11111111-1111-1111-1111-111111111111' };
    mockedCreateCertification.mockResolvedValue(created);

    const result = (await handler(
      makeEvent('POST', '/v1/certifications', validCertificationInput),
    )) as APIGatewayProxyStructuredResultV2;
    const body = JSON.parse(result.body ?? '{}') as { id: string; provider: string; config: object };

    expect(result.statusCode).toBe(201);
    expect(body.id).toBe('11111111-1111-1111-1111-111111111111');
    expect(body.provider).toBe('aws');
    expect(body.config).not.toHaveProperty('promptTemplate');
    expect(mockedCreateCertification).toHaveBeenCalledWith(validCertificationInput);
  });

  it('returns 400 Bad Request for invalid input', async () => {
    mockedCreateCertification.mockRejectedValue(new z.ZodError([]));

    const result = (await handler(
      makeEvent('POST', '/v1/certifications', {}),
    )) as APIGatewayProxyStructuredResultV2;
    const body = JSON.parse(result.body ?? '{}') as { error: string };

    expect(result.statusCode).toBe(400);
    expect(body.error).toBe('InvalidRequest');
  });

  it('returns 409 Conflict for duplicate provider+code', async () => {
    mockedCreateCertification.mockRejectedValue(new ConflictError('already exists'));

    const result = (await handler(
      makeEvent('POST', '/v1/certifications', validCertificationInput),
    )) as APIGatewayProxyStructuredResultV2;
    const body = JSON.parse(result.body ?? '{}') as { error: string };

    expect(result.statusCode).toBe(409);
    expect(body.error).toBe('Conflict');
  });
});
