import { describe, it, expect, vi, beforeEach } from 'vitest';
import { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { handler } from './index.js';
import {
  createCertification as createCertificationRecord,
  getCertificationByProviderCode,
  listCertifications,
  getCertificationById,
  updateCertification as updateCertificationRecord,
} from '../shared/repositories/certifications.js';
import { requestExamGeneration, toCreatedExamResponse } from '../shared/services/examGeneration.js';
import { NotFoundError } from '../shared/errors.js';
import { certification, certificationInput, certificationUpdate } from '../test/fixtures/certification.js';

vi.mock('../shared/repositories/certifications.js', () => ({
  createCertification: vi.fn(),
  getCertificationByProviderCode: vi.fn(),
  listCertifications: vi.fn(),
  getCertificationById: vi.fn(),
  updateCertification: vi.fn(),
}));

vi.mock('../shared/services/examGeneration.js', () => ({
  requestExamGeneration: vi.fn(),
  toCreatedExamResponse: vi.fn(),
}));

const mockedGetByProviderCode = vi.mocked(getCertificationByProviderCode);
const mockedCreateRecord = vi.mocked(createCertificationRecord);
const mockedListCertifications = vi.mocked(listCertifications);
const mockedGetById = vi.mocked(getCertificationById);
const mockedUpdateRecord = vi.mocked(updateCertificationRecord);
const mockedRequestExamGeneration = vi.mocked(requestExamGeneration);
const mockedToCreatedExamResponse = vi.mocked(toCreatedExamResponse);

beforeEach(() => {
  vi.clearAllMocks();
});

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
  it('returns 201 Created with the public certification', async () => {
    mockedGetByProviderCode.mockResolvedValue(null);
    mockedCreateRecord.mockResolvedValue(undefined);

    const result = (await handler(
      makeEvent('POST', '/v1/certifications', certificationInput),
    )) as APIGatewayProxyStructuredResultV2;
    const body = JSON.parse(result.body ?? '{}') as { id: string; provider: string; config: object };

    expect(result.statusCode).toBe(201);
    expect(body.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(body.provider).toBe('aws');
    expect(body.config).not.toHaveProperty('promptTemplate');
    expect(mockedCreateRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'aws',
        code: 'CLF-C02',
      }),
    );
  });

  it('returns 400 Bad Request for invalid input', async () => {
    mockedGetByProviderCode.mockResolvedValue(null);

    const result = (await handler(
      makeEvent('POST', '/v1/certifications', {}),
    )) as APIGatewayProxyStructuredResultV2;
    const body = JSON.parse(result.body ?? '{}') as { error: string };

    expect(result.statusCode).toBe(400);
    expect(body.error).toBe('InvalidRequest');
  });

  it('returns 409 Conflict for duplicate provider+code', async () => {
    mockedGetByProviderCode.mockResolvedValue(certification);

    const result = (await handler(
      makeEvent('POST', '/v1/certifications', certificationInput),
    )) as APIGatewayProxyStructuredResultV2;
    const body = JSON.parse(result.body ?? '{}') as { error: string };

    expect(result.statusCode).toBe(409);
    expect(body.error).toBe('Conflict');
  });
});

describe('GET /v1/certifications', () => {
  it('returns active certifications without promptTemplate', async () => {
    mockedListCertifications.mockResolvedValue([certification]);

    const result = (await handler(makeEvent('GET', '/v1/certifications'))) as APIGatewayProxyStructuredResultV2;
    const body = JSON.parse(result.body ?? '{}') as { items: Array<{ config: object }> };

    expect(result.statusCode).toBe(200);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].config).not.toHaveProperty('promptTemplate');
  });
});

describe('GET /v1/certifications/{id}', () => {
  it('returns the certification without promptTemplate', async () => {
    mockedGetById.mockResolvedValue(certification);

    const result = (await handler(
      makeEvent('GET', '/v1/certifications/11111111-1111-1111-1111-111111111111'),
    )) as APIGatewayProxyStructuredResultV2;
    const body = JSON.parse(result.body ?? '{}') as { id: string; config: object };

    expect(result.statusCode).toBe(200);
    expect(body.id).toBe('11111111-1111-1111-1111-111111111111');
    expect(body.config).not.toHaveProperty('promptTemplate');
  });

  it('returns 404 Not Found for unknown id', async () => {
    mockedGetById.mockResolvedValue(null);

    const result = (await handler(
      makeEvent('GET', '/v1/certifications/unknown-id'),
    )) as APIGatewayProxyStructuredResultV2;
    const body = JSON.parse(result.body ?? '{}') as { error: string };

    expect(result.statusCode).toBe(404);
    expect(body.error).toBe('NotFound');
  });
});

describe('PUT /v1/certifications/{id}', () => {
  it('returns 200 OK with the updated public certification', async () => {
    mockedGetById.mockResolvedValue(certification);
    mockedUpdateRecord.mockResolvedValue(undefined);

    const result = (await handler(
      makeEvent('PUT', '/v1/certifications/11111111-1111-1111-1111-111111111111', certificationUpdate),
    )) as APIGatewayProxyStructuredResultV2;
    const body = JSON.parse(result.body ?? '{}') as { id: string; provider: string; config: object };

    expect(result.statusCode).toBe(200);
    expect(body.id).toBe('11111111-1111-1111-1111-111111111111');
    expect(body.provider).toBe('aws');
    expect(body.config).not.toHaveProperty('promptTemplate');
  });

  it('returns 400 Bad Request when provider or code is included', async () => {
    const result = (await handler(
      makeEvent('PUT', '/v1/certifications/11111111-1111-1111-1111-111111111111', {
        ...certificationUpdate,
        provider: 'azure',
      }),
    )) as APIGatewayProxyStructuredResultV2;
    const body = JSON.parse(result.body ?? '{}') as { error: string };

    expect(result.statusCode).toBe(400);
    expect(body.error).toBe('InvalidRequest');
  });

  it('returns 404 Not Found for unknown id', async () => {
    mockedGetById.mockResolvedValue(null);

    const result = (await handler(
      makeEvent('PUT', '/v1/certifications/unknown-id', certificationUpdate),
    )) as APIGatewayProxyStructuredResultV2;
    const body = JSON.parse(result.body ?? '{}') as { error: string };

    expect(result.statusCode).toBe(404);
    expect(body.error).toBe('NotFound');
  });

  it('returns 400 Bad Request for invalid config', async () => {
    mockedGetById.mockResolvedValue(certification);

    const result = (await handler(
      makeEvent('PUT', '/v1/certifications/11111111-1111-1111-1111-111111111111', {
        ...certificationUpdate,
        config: { ...certificationUpdate.config, questionCount: 0 },
      }),
    )) as APIGatewayProxyStructuredResultV2;
    const body = JSON.parse(result.body ?? '{}') as { error: string };

    expect(result.statusCode).toBe(400);
    expect(body.error).toBe('InvalidRequest');
  });
});

describe('POST /v1/exams', () => {
  const examResponse = {
    id: '22222222-2222-2222-2222-222222222222',
    certificationId: certification.id,
    status: 'GENERATING' as const,
    title: 'AWS Certified Cloud Practitioner - Practice Exam 2026-07-28T12:00:00.000Z',
    createdAt: '2026-07-28T12:00:00.000Z',
  };

  it('returns 201 Created and requests exam generation', async () => {
    mockedRequestExamGeneration.mockResolvedValue({
      ...examResponse,
      provider: certification.provider,
      finishedAt: null,
      s3KeyJson: undefined,
      s3KeyPdf: undefined,
    } as unknown as Parameters<typeof toCreatedExamResponse>[0]);
    mockedToCreatedExamResponse.mockReturnValue(examResponse);

    const result = (await handler(
      makeEvent('POST', '/v1/exams', { certificationId: certification.id }),
    )) as APIGatewayProxyStructuredResultV2;
    const body = JSON.parse(result.body ?? '{}') as typeof examResponse;

    expect(result.statusCode).toBe(201);
    expect(body).toEqual(examResponse);
    expect(mockedRequestExamGeneration).toHaveBeenCalledWith(certification.id);
  });

  it('returns 400 Bad Request when certificationId is missing', async () => {
    const result = (await handler(
      makeEvent('POST', '/v1/exams', {}),
    )) as APIGatewayProxyStructuredResultV2;
    const body = JSON.parse(result.body ?? '{}') as { error: string };

    expect(result.statusCode).toBe(400);
    expect(body.error).toBe('InvalidRequest');
    expect(mockedRequestExamGeneration).not.toHaveBeenCalled();
  });

  it('returns 404 Not Found when certification is unknown or inactive', async () => {
    mockedRequestExamGeneration.mockRejectedValue(new NotFoundError('Certification'));

    const result = (await handler(
      makeEvent('POST', '/v1/exams', { certificationId: certification.id }),
    )) as APIGatewayProxyStructuredResultV2;
    const body = JSON.parse(result.body ?? '{}') as { error: string };

    expect(result.statusCode).toBe(404);
    expect(body.error).toBe('NotFound');
  });
});
