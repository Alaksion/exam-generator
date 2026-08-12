import { describe, it, expect, vi, beforeEach } from 'vitest';
import { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from './index.js';
import {
  createCertification as createCertificationRecord,
  getCertificationByProviderCode,
  listCertifications,
  getCertificationById,
  updateCertification as updateCertificationRecord,
} from '../shared/repositories/certifications.js';
import { requestExamGeneration, toCreatedExamResponse } from '../shared/services/examGeneration.js';
import { requestPasswordReset } from '../shared/services/passwordReset.js';
import { NotFoundError, UnauthorizedError } from '../shared/errors.js';
import { getCurrentUser } from '../shared/services/identity.js';
import {
  getCanonicalExam,
  getPresignedDownloadUrl,
  deleteArtifacts,
} from '../shared/repositories/artifacts.js';
import { getExamById, listExams, deleteExam } from '../shared/repositories/exams.js';
import {
  certification,
  certificationInput,
  certificationUpdate,
} from '../test/fixtures/certification.js';

vi.mock('../shared/repositories/certifications.js', () => ({
  createCertification: vi.fn(),
  getCertificationByProviderCode: vi.fn(),
  listCertifications: vi.fn(),
  getCertificationById: vi.fn(),
  updateCertification: vi.fn(),
}));

vi.mock('../shared/services/examGeneration.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../shared/services/examGeneration.js')>();
  return {
    ...actual,
    requestExamGeneration: vi.fn(),
    toCreatedExamResponse: vi.fn(),
  };
});

vi.mock('../shared/repositories/exams.js', () => ({
  getExamById: vi.fn(),
  listExams: vi.fn(),
  deleteExam: vi.fn(),
}));

vi.mock('../shared/repositories/artifacts.js', () => ({
  getCanonicalExam: vi.fn(),
  getPresignedDownloadUrl: vi.fn(),
  deleteArtifacts: vi.fn(),
}));

vi.mock('../shared/services/passwordReset.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../shared/services/passwordReset.js')>();
  return {
    ...actual,
    requestPasswordReset: vi.fn(),
  };
});

vi.mock('../shared/services/identity.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../shared/services/identity.js')>();
  return {
    ...actual,
    getCurrentUser: vi.fn(),
  };
});

const mockedGetByProviderCode = vi.mocked(getCertificationByProviderCode);
const mockedCreateRecord = vi.mocked(createCertificationRecord);
const mockedListCertifications = vi.mocked(listCertifications);
const mockedGetById = vi.mocked(getCertificationById);
const mockedUpdateRecord = vi.mocked(updateCertificationRecord);
const mockedRequestExamGeneration = vi.mocked(requestExamGeneration);
const mockedToCreatedExamResponse = vi.mocked(toCreatedExamResponse);
const mockedGetExamById = vi.mocked(getExamById);
const mockedListExams = vi.mocked(listExams);
const mockedDeleteExam = vi.mocked(deleteExam);
const mockedGetCanonicalExam = vi.mocked(getCanonicalExam);
const mockedGetPresignedDownloadUrl = vi.mocked(getPresignedDownloadUrl);
const mockedDeleteArtifacts = vi.mocked(deleteArtifacts);
const mockedRequestPasswordReset = vi.mocked(requestPasswordReset);
const mockedGetCurrentUser = vi.mocked(getCurrentUser);

beforeEach(() => {
  vi.clearAllMocks();
});

function makeEvent(
  method: string,
  path: string,
  body?: unknown,
  query?: Record<string, string>,
  headers: Record<string, string> = {},
): APIGatewayProxyEvent {
  return {
    httpMethod: method,
    path,
    queryStringParameters: query ?? null,
    headers,
    body: body === undefined ? null : JSON.stringify(body),
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEvent;
}

describe('health endpoint', () => {
  it('returns 200 OK with a status payload', async () => {
    const result = await handler(makeEvent('GET', '/v1/health'));
    const body = JSON.parse(result.body ?? '{}') as { status: string };

    expect(result.statusCode).toBe(200);
    expect(result.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(body.status).toBe('ok');
  });
});

describe('POST /v1/auth/forgot-password', () => {
  it('returns ok and proxies the reset request', async () => {
    mockedRequestPasswordReset.mockResolvedValue({ status: 'ok' });

    const result = await handler(
      makeEvent('POST', '/v1/auth/forgot-password', { email: 'Alice@Example.com' }),
    );
    const body = JSON.parse(result.body ?? '{}') as { status: string };

    expect(result.statusCode).toBe(200);
    expect(body).toEqual({ status: 'ok' });
    expect(mockedRequestPasswordReset).toHaveBeenCalledWith('alice@example.com');
  });

  it('returns 400 for a missing email', async () => {
    const result = await handler(makeEvent('POST', '/v1/auth/forgot-password', {}));
    const body = JSON.parse(result.body ?? '{}') as { error: string };

    expect(result.statusCode).toBe(400);
    expect(body.error).toBe('InvalidRequest');
    expect(mockedRequestPasswordReset).not.toHaveBeenCalled();
  });
});

describe('GET /v1/me', () => {
  const meUser = {
    userId: 'sub-alice',
    email: 'alice@example.com',
    role: 'customer' as const,
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  it('returns the caller identity for an authenticated user', async () => {
    mockedGetCurrentUser.mockResolvedValue(meUser);
    const result = await handler(makeEvent('GET', '/v1/me'));
    const body = JSON.parse(result.body ?? '{}') as {
      sub: string;
      email: string;
      role: string;
      createdAt: string;
    };

    expect(result.statusCode).toBe(200);
    expect(body).toEqual({
      sub: 'sub-alice',
      email: 'alice@example.com',
      role: 'customer',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('returns 401 Unauthorized without a valid token', async () => {
    mockedGetCurrentUser.mockRejectedValue(new UnauthorizedError());
    const result = await handler(makeEvent('GET', '/v1/me'));
    const body = JSON.parse(result.body ?? '{}') as { error: string };

    expect(result.statusCode).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 401 Unauthorized when no Users row exists', async () => {
    mockedGetCurrentUser.mockRejectedValue(
      new UnauthorizedError('No account found for this identity.'),
    );
    const result = await handler(makeEvent('GET', '/v1/me'));
    const body = JSON.parse(result.body ?? '{}') as { error: string };

    expect(result.statusCode).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });
});

describe('CORS handling', () => {
  it('echoes Access-Control-Allow-Origin for an allowed origin', async () => {
    const result = await handler(
      makeEvent('GET', '/v1/health', undefined, undefined, {
        Origin: 'http://localhost:5173',
      }),
    );

    expect(result.statusCode).toBe(200);
    expect(result.headers?.['Access-Control-Allow-Origin']).toBe('http://localhost:5173');
  });

  it('omits Access-Control-Allow-Origin for a disallowed origin', async () => {
    const result = await handler(
      makeEvent('GET', '/v1/health', undefined, undefined, {
        Origin: 'https://evil.example.com',
      }),
    );

    expect(result.statusCode).toBe(200);
    expect(result.headers?.['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('answers OPTIONS with CORS headers for an allowed origin', async () => {
    const result = await handler(
      makeEvent('OPTIONS', '/v1/certifications', undefined, undefined, {
        Origin: 'http://localhost:5173',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'content-type,authorization',
      }),
    );

    expect(result.statusCode).toBe(204);
    expect(result.headers?.['Access-Control-Allow-Origin']).toBe('http://localhost:5173');
    expect(result.headers?.['Access-Control-Allow-Methods']).toContain('GET');
  });
});

describe('POST /v1/certifications', () => {
  it('returns 201 Created with the public certification', async () => {
    mockedGetByProviderCode.mockResolvedValue(null);
    mockedCreateRecord.mockResolvedValue(undefined);

    const result = await handler(makeEvent('POST', '/v1/certifications', certificationInput));
    const body = JSON.parse(result.body ?? '{}') as {
      id: string;
      provider: string;
      config: { domains: Array<{ topics: Array<{ name: string; context: string }> }> };
    };

    expect(result.statusCode).toBe(201);
    expect(body.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(body.provider).toBe('aws');
    expect(body.config).not.toHaveProperty('promptTemplate');
    expect(body.config.domains[0].topics[0].context).toBe(
      certificationInput.config.domains[0].topics[0].context,
    );
    expect(mockedCreateRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'aws',
        code: 'CLF-C02',
      }),
    );
  });

  it('returns 400 Bad Request for invalid input', async () => {
    mockedGetByProviderCode.mockResolvedValue(null);

    const result = await handler(makeEvent('POST', '/v1/certifications', {}));
    const body = JSON.parse(result.body ?? '{}') as { error: string };

    expect(result.statusCode).toBe(400);
    expect(body.error).toBe('InvalidRequest');
  });

  it('returns 409 Conflict for duplicate provider+code', async () => {
    mockedGetByProviderCode.mockResolvedValue(certification);

    const result = await handler(makeEvent('POST', '/v1/certifications', certificationInput));
    const body = JSON.parse(result.body ?? '{}') as { error: string };

    expect(result.statusCode).toBe(409);
    expect(body.error).toBe('Conflict');
  });
});

describe('GET /v1/certifications', () => {
  it('returns active certifications without promptTemplate', async () => {
    mockedListCertifications.mockResolvedValue([certification]);

    const result = await handler(makeEvent('GET', '/v1/certifications'));
    const body = JSON.parse(result.body ?? '{}') as { items: Array<{ config: object }> };

    expect(result.statusCode).toBe(200);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].config).not.toHaveProperty('promptTemplate');
    const topics = (
      body.items[0].config as { domains: Array<{ topics: unknown[] }> }
    ).domains.flatMap((domain) => domain.topics);
    expect(topics).toHaveLength(5);
    for (const topic of topics) {
      expect(topic).toHaveProperty('context');
    }
  });
});

describe('GET /v1/certifications/{id}', () => {
  it('returns the certification with topic context', async () => {
    mockedGetById.mockResolvedValue(certification);

    const result = await handler(
      makeEvent('GET', '/v1/certifications/11111111-1111-1111-1111-111111111111'),
    );
    const body = JSON.parse(result.body ?? '{}') as {
      id: string;
      config: { domains: Array<{ topics: Array<{ name: string; context: string }> }> };
    };

    expect(result.statusCode).toBe(200);
    expect(body.id).toBe('11111111-1111-1111-1111-111111111111');
    expect(body.config).not.toHaveProperty('promptTemplate');
    const topics = body.config.domains.flatMap((domain) => domain.topics);
    expect(topics).toHaveLength(5);
    for (const topic of topics) {
      expect(topic.context.length).toBeGreaterThanOrEqual(20);
    }
  });

  it('returns 404 Not Found for unknown id', async () => {
    mockedGetById.mockResolvedValue(null);

    const result = await handler(makeEvent('GET', '/v1/certifications/unknown-id'));
    const body = JSON.parse(result.body ?? '{}') as { error: string };

    expect(result.statusCode).toBe(404);
    expect(body.error).toBe('NotFound');
  });
});

describe('PUT /v1/certifications/{id}', () => {
  it('returns 200 OK with the updated public certification', async () => {
    mockedGetById.mockResolvedValue(certification);
    mockedUpdateRecord.mockResolvedValue(undefined);

    const result = await handler(
      makeEvent(
        'PUT',
        '/v1/certifications/11111111-1111-1111-1111-111111111111',
        certificationUpdate,
      ),
    );
    const body = JSON.parse(result.body ?? '{}') as {
      id: string;
      provider: string;
      config: object;
    };

    expect(result.statusCode).toBe(200);
    expect(body.id).toBe('11111111-1111-1111-1111-111111111111');
    expect(body.provider).toBe('aws');
    expect(body.config).not.toHaveProperty('promptTemplate');
  });

  it('returns 400 Bad Request when provider or code is included', async () => {
    const result = await handler(
      makeEvent('PUT', '/v1/certifications/11111111-1111-1111-1111-111111111111', {
        ...certificationUpdate,
        provider: 'azure',
      }),
    );
    const body = JSON.parse(result.body ?? '{}') as { error: string };

    expect(result.statusCode).toBe(400);
    expect(body.error).toBe('InvalidRequest');
  });

  it('returns 404 Not Found for unknown id', async () => {
    mockedGetById.mockResolvedValue(null);

    const result = await handler(
      makeEvent('PUT', '/v1/certifications/unknown-id', certificationUpdate),
    );
    const body = JSON.parse(result.body ?? '{}') as { error: string };

    expect(result.statusCode).toBe(404);
    expect(body.error).toBe('NotFound');
  });

  it('returns 400 Bad Request for invalid config', async () => {
    mockedGetById.mockResolvedValue(certification);

    const result = await handler(
      makeEvent('PUT', '/v1/certifications/11111111-1111-1111-1111-111111111111', {
        ...certificationUpdate,
        config: { ...certificationUpdate.config, questionCount: 0 },
      }),
    );
    const body = JSON.parse(result.body ?? '{}') as { error: string };

    expect(result.statusCode).toBe(400);
    expect(body.error).toBe('InvalidRequest');
  });
});

describe('POST /v1/exams', () => {
  const examResponse = {
    id: '22222222-2222-2222-2222-222222222222',
    status: 'PENDING' as const,
  };

  it('returns 201 Created and requests exam generation', async () => {
    mockedRequestExamGeneration.mockResolvedValue({
      ...examResponse,
      certificationId: certification.id,
      provider: certification.provider,
      title: 'AWS Certified Cloud Practitioner - Practice Exam 2026-07-28T12:00:00.000Z',
      createdAt: '2026-07-28T12:00:00.000Z',
      finishedAt: null,
      s3KeyJson: undefined,
      s3KeyPdf: undefined,
    } as unknown as Parameters<typeof toCreatedExamResponse>[0]);
    mockedToCreatedExamResponse.mockReturnValue(examResponse);

    const result = await handler(
      makeEvent('POST', '/v1/exams', { certificationId: certification.id }),
    );
    const body = JSON.parse(result.body ?? '{}') as typeof examResponse;

    expect(result.statusCode).toBe(201);
    expect(body).toEqual(examResponse);
    expect(mockedRequestExamGeneration).toHaveBeenCalledWith(certification.id);
  });

  it('returns 400 Bad Request when certificationId is missing', async () => {
    const result = await handler(makeEvent('POST', '/v1/exams', {}));
    const body = JSON.parse(result.body ?? '{}') as { error: string };

    expect(result.statusCode).toBe(400);
    expect(body.error).toBe('InvalidRequest');
    expect(mockedRequestExamGeneration).not.toHaveBeenCalled();
  });

  it('returns 400 Bad Request when certificationId is not a valid UUID', async () => {
    const result = await handler(makeEvent('POST', '/v1/exams', { certificationId: 'not-a-uuid' }));
    const body = JSON.parse(result.body ?? '{}') as { error: string };

    expect(result.statusCode).toBe(400);
    expect(body.error).toBe('InvalidRequest');
    expect(mockedRequestExamGeneration).not.toHaveBeenCalled();
  });

  it('returns 404 Not Found when certification is unknown or inactive', async () => {
    mockedRequestExamGeneration.mockRejectedValue(new NotFoundError('Certification'));

    const result = await handler(
      makeEvent('POST', '/v1/exams', { certificationId: certification.id }),
    );
    const body = JSON.parse(result.body ?? '{}') as { error: string };

    expect(result.statusCode).toBe(404);
    expect(body.error).toBe('NotFound');
  });
});

const examId = '22222222-2222-2222-2222-222222222222';

const readyExam = {
  id: examId,
  certificationId: certification.id,
  provider: 'aws' as const,
  title: 'AWS Certified Cloud Practitioner - Practice Exam',
  status: 'READY' as const,
  createdAt: '2026-07-28T12:00:00.000Z',
  finishedAt: '2026-07-28T12:00:01.000Z',
  s3KeyJson: `exams/${examId}/exam.json`,
  s3KeyPdf: `exams/${examId}/exam.pdf`,
};

const generatingExam = {
  ...readyExam,
  status: 'GENERATING' as const,
  finishedAt: null,
  s3KeyJson: undefined,
  s3KeyPdf: undefined,
};

const fullExam = {
  ...readyExam,
  schemaVersion: '1.0.0',
  questions: [],
};

describe('GET /v1/exams/{id}/status', () => {
  it('returns the status payload for a ready exam', async () => {
    mockedGetExamById.mockResolvedValue(readyExam);

    const result = await handler(makeEvent('GET', `/v1/exams/${examId}/status`));
    const body = JSON.parse(result.body ?? '{}') as {
      id: string;
      status: string;
      createdAt: string;
      finishedAt: string;
    };

    expect(result.statusCode).toBe(200);
    expect(body.id).toBe(examId);
    expect(body.status).toBe('READY');
    expect(body.createdAt).toBe(readyExam.createdAt);
    expect(body.finishedAt).toBe(readyExam.finishedAt);
    expect(mockedGetCanonicalExam).not.toHaveBeenCalled();
  });

  it('returns 404 Not Found for an unknown exam', async () => {
    mockedGetExamById.mockResolvedValue(null);

    const result = await handler(makeEvent('GET', `/v1/exams/${examId}/status`));
    const body = JSON.parse(result.body ?? '{}') as { error: string };

    expect(result.statusCode).toBe(404);
    expect(body.error).toBe('NotFound');
  });
});

describe('GET /v1/exams/{id}', () => {
  it('returns the full canonical JSON when the exam is READY', async () => {
    mockedGetExamById.mockResolvedValue(readyExam);
    mockedGetCanonicalExam.mockResolvedValue(fullExam);

    const result = await handler(makeEvent('GET', `/v1/exams/${examId}`));
    const body = JSON.parse(result.body ?? '{}') as {
      schemaVersion: string;
      status: string;
      id: string;
    };

    expect(result.statusCode).toBe(200);
    expect(body.schemaVersion).toBe('1.0.0');
    expect(body.status).toBe('READY');
    expect(body.id).toBe(examId);
    expect(mockedGetCanonicalExam).toHaveBeenCalledWith(readyExam.s3KeyJson);
  });

  it('returns 409 ExamNotReady while the exam is GENERATING', async () => {
    mockedGetExamById.mockResolvedValue(generatingExam);

    const result = await handler(makeEvent('GET', `/v1/exams/${examId}`));
    const body = JSON.parse(result.body ?? '{}') as { error: string };

    expect(result.statusCode).toBe(409);
    expect(body.error).toBe('ExamNotReady');
    expect(mockedGetCanonicalExam).not.toHaveBeenCalled();
  });

  it('returns 404 Not Found for an unknown exam', async () => {
    mockedGetExamById.mockResolvedValue(null);

    const result = await handler(makeEvent('GET', `/v1/exams/${examId}`));
    const body = JSON.parse(result.body ?? '{}') as { error: string };

    expect(result.statusCode).toBe(404);
    expect(body.error).toBe('NotFound');
  });
});

describe('GET /v1/exams', () => {
  it('defaults to status=READY and returns exams with a cursor object', async () => {
    mockedListExams.mockResolvedValue({ exams: [readyExam] });

    const result = await handler(makeEvent('GET', '/v1/exams'));
    const body = JSON.parse(result.body ?? '{}') as {
      items: unknown[];
      cursor: { nextCursor: string | null; hasNextPage: boolean };
    };

    expect(result.statusCode).toBe(200);
    expect(body.items).toEqual([readyExam]);
    expect(body.cursor).toEqual({ nextCursor: null, hasNextPage: false });
    expect(mockedListExams).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'READY',
        limit: 20,
      }),
    );
  });

  it('supports status, provider, certificationId, limit, and cursor query params', async () => {
    mockedListExams.mockResolvedValue({
      exams: [readyExam],
      nextCursor: 'c3RhcnRLZXk=',
    });

    const result = await handler(
      makeEvent('GET', '/v1/exams', undefined, {
        status: 'GENERATING',
        provider: 'aws',
        certificationId: certification.id,
        limit: '10',
        cursor: 'c3RhcnRLZXk=',
      }),
    );
    const body = JSON.parse(result.body ?? '{}') as {
      items: unknown[];
      cursor: { nextCursor: string; hasNextPage: boolean };
    };

    expect(result.statusCode).toBe(200);
    expect(body.items).toEqual([readyExam]);
    expect(body.cursor.nextCursor).toBe('c3RhcnRLZXk=');
    expect(body.cursor.hasNextPage).toBe(true);
    expect(mockedListExams).toHaveBeenCalledWith({
      status: 'GENERATING',
      provider: 'aws',
      certificationId: certification.id,
      limit: 10,
      cursor: 'c3RhcnRLZXk=',
    });
  });

  it('returns 400 Bad Request for invalid query params', async () => {
    const result = await handler(
      makeEvent('GET', '/v1/exams', undefined, { limit: 'not-a-number' }),
    );
    const body = JSON.parse(result.body ?? '{}') as { error: string };

    expect(result.statusCode).toBe(400);
    expect(body.error).toBe('InvalidRequest');
    expect(mockedListExams).not.toHaveBeenCalled();
  });
});

describe('GET /v1/exams/{id}/download', () => {
  it('returns a presigned URL for a ready exam', async () => {
    const downloadUrl = 'https://s3.example.com/presigned';
    const expiresAt = '2026-07-31T12:10:00.000Z';
    mockedGetExamById.mockResolvedValue(readyExam);
    mockedGetPresignedDownloadUrl.mockResolvedValue({ url: downloadUrl, expiresAt });

    const result = await handler(makeEvent('GET', `/v1/exams/${examId}/download`));
    const body = JSON.parse(result.body ?? '{}') as { downloadUrl: string; expiresAt: string };

    expect(result.statusCode).toBe(200);
    expect(body.downloadUrl).toBe(downloadUrl);
    expect(body.expiresAt).toBe(expiresAt);
    expect(mockedGetPresignedDownloadUrl).toHaveBeenCalledWith(readyExam.s3KeyPdf);
  });

  it('returns 409 ExamNotReady while the exam is GENERATING', async () => {
    mockedGetExamById.mockResolvedValue(generatingExam);

    const result = await handler(makeEvent('GET', `/v1/exams/${examId}/download`));
    const body = JSON.parse(result.body ?? '{}') as { error: string };

    expect(result.statusCode).toBe(409);
    expect(body.error).toBe('ExamNotReady');
    expect(mockedGetPresignedDownloadUrl).not.toHaveBeenCalled();
  });
});

describe('DELETE /v1/exams/{id}', () => {
  it('deletes the DynamoDB row and associated S3 objects', async () => {
    mockedGetExamById.mockResolvedValue(readyExam);
    mockedDeleteArtifacts.mockResolvedValue(undefined);
    mockedDeleteExam.mockResolvedValue(undefined);

    const result = await handler(makeEvent('DELETE', `/v1/exams/${examId}`));

    expect(result.statusCode).toBe(204);
    expect(mockedDeleteArtifacts).toHaveBeenCalledWith([readyExam.s3KeyJson, readyExam.s3KeyPdf]);
    expect(mockedDeleteExam).toHaveBeenCalledWith(examId);
  });

  it('deletes the DynamoDB row when no S3 objects exist', async () => {
    mockedGetExamById.mockResolvedValue(generatingExam);
    mockedDeleteExam.mockResolvedValue(undefined);

    const result = await handler(makeEvent('DELETE', `/v1/exams/${examId}`));

    expect(result.statusCode).toBe(204);
    expect(mockedDeleteArtifacts).not.toHaveBeenCalled();
    expect(mockedDeleteExam).toHaveBeenCalledWith(examId);
  });

  it('returns 404 Not Found for an unknown exam', async () => {
    mockedGetExamById.mockResolvedValue(null);

    const result = await handler(makeEvent('GET', `/v1/exams/${examId}/download`));
    const body = JSON.parse(result.body ?? '{}') as { error: string };

    expect(result.statusCode).toBe(404);
    expect(body.error).toBe('NotFound');

    expect(mockedDeleteArtifacts).not.toHaveBeenCalled();
    expect(mockedDeleteExam).not.toHaveBeenCalled();
  });
});
