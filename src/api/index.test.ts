import { describe, it, expect, vi, beforeEach } from 'vitest';
import { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { handler } from './index.js';
import {
  createCertification as createCertificationRecord,
  getCertificationByProviderCode,
} from '../shared/repositories/certifications.js';
import { certification, certificationInput } from '../test/fixtures/certification.js';

vi.mock('../shared/repositories/certifications.js', () => ({
  createCertification: vi.fn(),
  getCertificationByProviderCode: vi.fn(),
}));

const mockedGetByProviderCode = vi.mocked(getCertificationByProviderCode);
const mockedCreateRecord = vi.mocked(createCertificationRecord);

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
