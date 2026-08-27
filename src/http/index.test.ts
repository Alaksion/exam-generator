import { describe, it, expect, vi, beforeEach } from 'vitest';
import { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from './index.js';
import {
  createCertification as createCertificationRecord,
  getCertificationByProviderCode,
  listActiveCertifications,
  getCertificationById,
  updateCertification as updateCertificationRecord,
} from '../data/datasources/certifications.js';
import {
  getExamById,
  listExams,
  deleteExam,
  createExam as createExamRecord,
} from '../data/datasources/exams.js';
import { sendGeneratorMessage } from '../data/datasources/generatorQueue.js';
import {
  getCanonicalExam,
  getPresignedDownloadUrl,
  deleteArtifacts,
} from '../data/datasources/artifacts.js';
import { getUserById, listUsers, updateUserRole } from '../data/datasources/users.js';
import { requestPasswordReset } from '../services/passwordResetService.js';
import {
  certification,
  certificationInput,
  certificationUpdate,
} from '../test/fixtures/certification.js';

vi.mock('../data/datasources/certifications.js', () => ({
  createCertification: vi.fn(),
  getCertificationByProviderCode: vi.fn(),
  listActiveCertifications: vi.fn(),
  getCertificationById: vi.fn(),
  updateCertification: vi.fn(),
}));

vi.mock('../data/datasources/exams.js', () => ({
  getExamById: vi.fn(),
  listExams: vi.fn(),
  deleteExam: vi.fn(),
  createExam: vi.fn(),
  updateExamStatus: vi.fn(),
}));

vi.mock('../data/datasources/generatorQueue.js', () => ({
  sendGeneratorMessage: vi.fn(),
}));

vi.mock('../data/datasources/users.js', () => ({
  getUserById: vi.fn(),
  getUserByEmail: vi.fn(),
  createUser: vi.fn(),
  listUsers: vi.fn(),
  updateUserRole: vi.fn(),
  normalizeEmail: (email: string) => email.trim().toLowerCase(),
}));

vi.mock('../data/datasources/artifacts.js', () => ({
  getCanonicalExam: vi.fn(),
  getPresignedDownloadUrl: vi.fn(),
  deleteArtifacts: vi.fn(),
  putArtifact: vi.fn(),
}));

vi.mock('../services/passwordResetService.js', () => ({
  requestPasswordReset: vi.fn(),
}));

const mockedGetByProviderCode = vi.mocked(getCertificationByProviderCode);
const mockedCreateCertification = vi.mocked(createCertificationRecord);
const mockedListCertifications = vi.mocked(listActiveCertifications);
const mockedGetCertification = vi.mocked(getCertificationById);
const mockedUpdateCertification = vi.mocked(updateCertificationRecord);
const mockedGetExam = vi.mocked(getExamById);
const mockedListExams = vi.mocked(listExams);
const mockedDeleteExam = vi.mocked(deleteExam);
const mockedCreateExam = vi.mocked(createExamRecord);
const mockedSendGeneratorMessage = vi.mocked(sendGeneratorMessage);
const mockedGetUser = vi.mocked(getUserById);
const mockedListUsers = vi.mocked(listUsers);
const mockedUpdateUserRole = vi.mocked(updateUserRole);
const mockedGetCanonicalExam = vi.mocked(getCanonicalExam);
const mockedGetPresignedDownloadUrl = vi.mocked(getPresignedDownloadUrl);
const mockedDeleteArtifacts = vi.mocked(deleteArtifacts);
const mockedRequestPasswordReset = vi.mocked(requestPasswordReset);

const currentUser = {
  userId: 'sub-alice',
  email: 'alice@example.com',
  role: 'customer' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const adminUser = {
  userId: 'sub-admin',
  email: 'admin@example.com',
  role: 'admin' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const targetUser = {
  userId: 'sub-bob',
  email: 'bob@example.com',
  role: 'customer' as const,
  createdAt: '2026-02-02T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetUser.mockResolvedValue(currentUser);
});

function makeEvent(
  method: string,
  path: string,
  body?: unknown,
  query?: Record<string, string>,
  headers: Record<string, string> = {},
  sub?: string | null,
): APIGatewayProxyEvent {
  return {
    httpMethod: method,
    path,
    queryStringParameters: query ?? null,
    headers,
    body: body === undefined ? null : JSON.stringify(body),
    isBase64Encoded: false,
    requestContext:
      sub === null
        ? {}
        : { authorizer: { claims: { sub: sub ?? 'sub-alice' } } },
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

  it('rejects an invalid email', async () => {
    const result = await handler(
      makeEvent('POST', '/v1/auth/forgot-password', { email: 'not-an-email' }),
    );

    expect(result.statusCode).toBe(400);
    expect(mockedRequestPasswordReset).not.toHaveBeenCalled();
  });
});

describe('GET /v1/me', () => {
  it('returns the caller identity for an authenticated user', async () => {
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
    const result = await handler(makeEvent('GET', '/v1/me', undefined, undefined, {}, null));

    expect(result.statusCode).toBe(401);
  });

  it('returns 401 Unauthorized when no Users row exists', async () => {
    mockedGetUser.mockResolvedValue(null);
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

describe('POST /v1/admin/certifications', () => {
  it('returns 201 Created with the public certification', async () => {
    mockedGetUser.mockResolvedValue(adminUser);
    mockedGetByProviderCode.mockResolvedValue(null);
    mockedCreateCertification.mockResolvedValue(undefined);

    const result = await handler(makeEvent('POST', '/v1/admin/certifications', certificationInput));
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
    expect(mockedCreateCertification).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'aws',
        code: 'CLF-C02',
      }),
    );
  });

  it('returns 400 Bad Request for invalid input', async () => {
    mockedGetUser.mockResolvedValue(adminUser);

    const result = await handler(makeEvent('POST', '/v1/admin/certifications', {}));
    const body = JSON.parse(result.body ?? '{}') as { error: string };

    expect(result.statusCode).toBe(400);
    expect(body.error).toBe('InvalidRequest');
  });

  it('returns 409 Conflict for duplicate provider+code', async () => {
    mockedGetUser.mockResolvedValue(adminUser);
    mockedGetByProviderCode.mockResolvedValue(certification);

    const result = await handler(makeEvent('POST', '/v1/admin/certifications', certificationInput));
    const body = JSON.parse(result.body ?? '{}') as { error: string };

    expect(result.statusCode).toBe(409);
    expect(body.error).toBe('Conflict');
  });

  it('returns 403 Forbidden for a customer', async () => {
    const result = await handler(makeEvent('POST', '/v1/admin/certifications', certificationInput));
    const body = JSON.parse(result.body ?? '{}') as { error: string };

    expect(result.statusCode).toBe(403);
    expect(body.error).toBe('Forbidden');
    expect(mockedCreateCertification).not.toHaveBeenCalled();
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
    mockedGetCertification.mockResolvedValue(certification);

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
    mockedGetCertification.mockResolvedValue(null);

    const result = await handler(makeEvent('GET', '/v1/certifications/unknown-id'));
    const body = JSON.parse(result.body ?? '{}') as { error: string };

    expect(result.statusCode).toBe(404);
    expect(body.error).toBe('NotFound');
  });
});

describe('PUT /v1/admin/certifications/{id}', () => {
  it('returns 200 OK with the updated public certification', async () => {
    mockedGetUser.mockResolvedValue(adminUser);
    mockedGetCertification.mockResolvedValue(certification);
    mockedUpdateCertification.mockResolvedValue(undefined);

    const result = await handler(
      makeEvent(
        'PUT',
        '/v1/admin/certifications/11111111-1111-1111-1111-111111111111',
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
    mockedGetUser.mockResolvedValue(adminUser);
    const result = await handler(
      makeEvent('PUT', '/v1/admin/certifications/11111111-1111-1111-1111-111111111111', {
        ...certificationUpdate,
        provider: 'azure',
      }),
    );
    const body = JSON.parse(result.body ?? '{}') as { error: string };

    expect(result.statusCode).toBe(400);
    expect(body.error).toBe('InvalidRequest');
    expect(mockedUpdateCertification).not.toHaveBeenCalled();
  });

  it('returns 404 Not Found for unknown id', async () => {
    mockedGetUser.mockResolvedValue(adminUser);
    mockedGetCertification.mockResolvedValue(null);

    const result = await handler(
      makeEvent('PUT', '/v1/admin/certifications/unknown-id', certificationUpdate),
    );
    const body = JSON.parse(result.body ?? '{}') as { error: string };

    expect(result.statusCode).toBe(404);
    expect(body.error).toBe('NotFound');
    expect(mockedUpdateCertification).not.toHaveBeenCalled();
  });

  it('returns 400 Bad Request for invalid config', async () => {
    mockedGetUser.mockResolvedValue(adminUser);

    const result = await handler(
      makeEvent('PUT', '/v1/admin/certifications/11111111-1111-1111-1111-111111111111', {
        ...certificationUpdate,
        config: { ...certificationUpdate.config, questionCount: 0 },
      }),
    );
    const body = JSON.parse(result.body ?? '{}') as { error: string };

    expect(result.statusCode).toBe(400);
    expect(body.error).toBe('InvalidRequest');
    expect(mockedUpdateCertification).not.toHaveBeenCalled();
  });

  it('returns 403 Forbidden for a customer', async () => {
    const result = await handler(
      makeEvent('PUT', '/v1/admin/certifications/11111111-1111-1111-1111-111111111111', {
        ...certificationUpdate,
      }),
    );
    const body = JSON.parse(result.body ?? '{}') as { error: string };

    expect(result.statusCode).toBe(403);
    expect(body.error).toBe('Forbidden');
    expect(mockedUpdateCertification).not.toHaveBeenCalled();
  });
});

describe('removed customer-facing certification write routes', () => {
  it('returns 404 for POST /v1/certifications', async () => {
    const result = await handler(makeEvent('POST', '/v1/certifications', certificationInput));
    const body = JSON.parse(result.body ?? '{}') as { error: string };

    expect(result.statusCode).toBe(404);
    expect(body.error).toBe('NotFound');
    expect(mockedCreateCertification).not.toHaveBeenCalled();
  });

  it('returns 404 for PUT /v1/certifications/{id}', async () => {
    const result = await handler(
      makeEvent(
        'PUT',
        '/v1/certifications/11111111-1111-1111-1111-111111111111',
        certificationUpdate,
      ),
    );
    const body = JSON.parse(result.body ?? '{}') as { error: string };

    expect(result.statusCode).toBe(404);
    expect(body.error).toBe('NotFound');
    expect(mockedUpdateCertification).not.toHaveBeenCalled();
  });
});

describe('POST /v1/exams', () => {
  it('returns 201 Created and requests exam generation for the caller', async () => {
    mockedGetCertification.mockResolvedValue(certification);
    mockedCreateExam.mockResolvedValue(undefined);
    mockedSendGeneratorMessage.mockResolvedValue(undefined);

    const result = await handler(
      makeEvent('POST', '/v1/exams', { certificationId: certification.id }),
    );
    const body = JSON.parse(result.body ?? '{}') as { id: string; status: string };

    expect(result.statusCode).toBe(201);
    expect(body).toEqual({
      id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i) as string,
      status: 'PENDING',
    });
    expect(mockedGetCertification).toHaveBeenCalledWith(certification.id);
    expect(mockedCreateExam).toHaveBeenCalledWith(
      expect.objectContaining({ certificationId: certification.id, ownerId: 'sub-alice' }),
    );
    const message = mockedSendGeneratorMessage.mock.calls[0][0];
    expect(message.examId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(message.certificationId).toBe(certification.id);
  });

  it('returns 400 Bad Request when certificationId is missing', async () => {
    const result = await handler(makeEvent('POST', '/v1/exams', {}));
    const body = JSON.parse(result.body ?? '{}') as { error: string };

    expect(result.statusCode).toBe(400);
    expect(body.error).toBe('InvalidRequest');
    expect(mockedGetCertification).not.toHaveBeenCalled();
  });

  it('returns 400 Bad Request when certificationId is not a valid UUID', async () => {
    const result = await handler(makeEvent('POST', '/v1/exams', { certificationId: 'not-a-uuid' }));
    const body = JSON.parse(result.body ?? '{}') as { error: string };

    expect(result.statusCode).toBe(400);
    expect(body.error).toBe('InvalidRequest');
    expect(mockedGetCertification).not.toHaveBeenCalled();
  });

  it('returns 404 Not Found when certification is unknown or inactive', async () => {
    mockedGetCertification.mockResolvedValue(null);

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
  ownerId: currentUser.userId,
  provider: 'aws' as const,
  title: 'AWS Certified Cloud Practitioner - Practice Exam',
  status: 'READY' as const,
  createdAt: '2026-07-28T12:00:00.000Z',
  finishedAt: '2026-07-28T12:00:01.000Z',
  s3KeyJson: `exams/${examId}/exam.json`,
  s3KeyPdf: `exams/${examId}/exam.pdf`,
};

const otherUserExam = {
  ...readyExam,
  id: '33333333-3333-3333-3333-333333333333',
  ownerId: 'sub-bob',
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
    mockedGetExam.mockResolvedValue(readyExam);

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

  it('returns 404 ExamNotFound for an unknown exam', async () => {
    mockedGetExam.mockResolvedValue(null);

    const result = await handler(makeEvent('GET', `/v1/exams/${examId}/status`));
    const body = JSON.parse(result.body ?? '{}') as { error: string };

    expect(result.statusCode).toBe(404);
    expect(body.error).toBe('ExamNotFound');
  });

  it('returns 404 Not Found for an exam owned by another user', async () => {
    mockedGetExam.mockResolvedValue(otherUserExam);

    const result = await handler(makeEvent('GET', `/v1/exams/${otherUserExam.id}/status`));
    const body = JSON.parse(result.body ?? '{}') as { error: string };

    expect(result.statusCode).toBe(404);
    expect(body.error).toBe('NotFound');
  });
});

describe('GET /v1/exams/{id}', () => {
  it('returns the full canonical JSON when the exam is READY', async () => {
    mockedGetExam.mockResolvedValue(readyExam);
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
    mockedGetExam.mockResolvedValue(generatingExam);

    const result = await handler(makeEvent('GET', `/v1/exams/${examId}`));
    const body = JSON.parse(result.body ?? '{}') as { error: string };

    expect(result.statusCode).toBe(409);
    expect(body.error).toBe('ExamNotReady');
    expect(mockedGetCanonicalExam).not.toHaveBeenCalled();
  });

  it('returns 404 ExamNotFound for an unknown exam', async () => {
    mockedGetExam.mockResolvedValue(null);

    const result = await handler(makeEvent('GET', `/v1/exams/${examId}`));
    const body = JSON.parse(result.body ?? '{}') as { error: string };

    expect(result.statusCode).toBe(404);
    expect(body.error).toBe('ExamNotFound');
  });

  it('returns 404 Not Found for an exam owned by another user', async () => {
    mockedGetExam.mockResolvedValue(otherUserExam);

    const result = await handler(makeEvent('GET', `/v1/exams/${otherUserExam.id}`));
    const body = JSON.parse(result.body ?? '{}') as { error: string };

    expect(result.statusCode).toBe(404);
    expect(body.error).toBe('NotFound');
    expect(mockedGetCanonicalExam).not.toHaveBeenCalled();
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
        ownerId: currentUser.userId,
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
      ownerId: currentUser.userId,
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
    mockedGetExam.mockResolvedValue(readyExam);
    mockedGetPresignedDownloadUrl.mockResolvedValue({ url: downloadUrl, expiresAt });

    const result = await handler(makeEvent('GET', `/v1/exams/${examId}/download`));
    const body = JSON.parse(result.body ?? '{}') as { downloadUrl: string; expiresAt: string };

    expect(result.statusCode).toBe(200);
    expect(body.downloadUrl).toBe(downloadUrl);
    expect(body.expiresAt).toBe(expiresAt);
    expect(mockedGetPresignedDownloadUrl).toHaveBeenCalledWith(readyExam.s3KeyPdf);
  });

  it('returns 409 ExamNotReady while the exam is GENERATING', async () => {
    mockedGetExam.mockResolvedValue(generatingExam);

    const result = await handler(makeEvent('GET', `/v1/exams/${examId}/download`));
    const body = JSON.parse(result.body ?? '{}') as { error: string };

    expect(result.statusCode).toBe(409);
    expect(body.error).toBe('ExamNotReady');
    expect(mockedGetPresignedDownloadUrl).not.toHaveBeenCalled();
  });

  it('returns 404 Not Found for an exam owned by another user', async () => {
    mockedGetExam.mockResolvedValue(otherUserExam);

    const result = await handler(makeEvent('GET', `/v1/exams/${otherUserExam.id}/download`));
    const body = JSON.parse(result.body ?? '{}') as { error: string };

    expect(result.statusCode).toBe(404);
    expect(body.error).toBe('NotFound');
    expect(mockedGetPresignedDownloadUrl).not.toHaveBeenCalled();
  });
});

describe('DELETE /v1/exams/{id}', () => {
  it('deletes the DynamoDB row and associated S3 objects', async () => {
    mockedGetExam.mockResolvedValue(readyExam);
    mockedDeleteArtifacts.mockResolvedValue(undefined);
    mockedDeleteExam.mockResolvedValue(undefined);

    const result = await handler(makeEvent('DELETE', `/v1/exams/${examId}`));

    expect(result.statusCode).toBe(204);
    expect(mockedDeleteArtifacts).toHaveBeenCalledWith([readyExam.s3KeyJson, readyExam.s3KeyPdf]);
    expect(mockedDeleteExam).toHaveBeenCalledWith(examId);
  });

  it('deletes the DynamoDB row when no S3 objects exist', async () => {
    mockedGetExam.mockResolvedValue(generatingExam);
    mockedDeleteExam.mockResolvedValue(undefined);

    const result = await handler(makeEvent('DELETE', `/v1/exams/${examId}`));

    expect(result.statusCode).toBe(204);
    expect(mockedDeleteArtifacts).not.toHaveBeenCalled();
    expect(mockedDeleteExam).toHaveBeenCalledWith(examId);
  });

  it('returns 404 ExamNotFound for an unknown exam', async () => {
    mockedGetExam.mockResolvedValue(null);
    mockedDeleteExam.mockResolvedValue(undefined);

    const result = await handler(makeEvent('DELETE', `/v1/exams/${examId}`));
    const body = JSON.parse(result.body ?? '{}') as { error: string };

    expect(result.statusCode).toBe(404);
    expect(body.error).toBe('ExamNotFound');

    expect(mockedDeleteArtifacts).not.toHaveBeenCalled();
    expect(mockedDeleteExam).not.toHaveBeenCalled();
  });

  it('returns 404 Not Found for an exam owned by another user', async () => {
    mockedGetExam.mockResolvedValue(otherUserExam);

    const result = await handler(makeEvent('DELETE', `/v1/exams/${otherUserExam.id}`));
    const body = JSON.parse(result.body ?? '{}') as { error: string };

    expect(result.statusCode).toBe(404);
    expect(body.error).toBe('NotFound');
    expect(mockedDeleteArtifacts).not.toHaveBeenCalled();
    expect(mockedDeleteExam).not.toHaveBeenCalled();
  });
});

describe('GET /v1/admin/exams', () => {
  it('returns exams from all users for an admin', async () => {
    mockedGetUser.mockResolvedValue(adminUser);
    mockedListExams.mockResolvedValue({
      exams: [readyExam, otherUserExam],
      nextCursor: 'c3RhcnRLZXk=',
    });

    const result = await handler(makeEvent('GET', '/v1/admin/exams'));
    const body = JSON.parse(result.body ?? '{}') as {
      items: unknown[];
      cursor: { nextCursor: string | null; hasNextPage: boolean };
    };

    expect(result.statusCode).toBe(200);
    expect(body.items).toEqual([readyExam, otherUserExam]);
    expect(body.cursor).toEqual({ nextCursor: 'c3RhcnRLZXk=', hasNextPage: true });
    expect(mockedListExams).toHaveBeenCalledWith({
      status: 'READY',
      limit: 20,
    });
    expect(mockedListExams.mock.calls[0][0]).not.toHaveProperty('ownerId');
  });

  it('passes through status, provider, certificationId, limit, and cursor query params', async () => {
    mockedGetUser.mockResolvedValue(adminUser);
    mockedListExams.mockResolvedValue({ exams: [otherUserExam] });

    const result = await handler(
      makeEvent('GET', '/v1/admin/exams', undefined, {
        status: 'GENERATING',
        provider: 'aws',
        certificationId: certification.id,
        limit: '10',
        cursor: 'c3RhcnRLZXk=',
      }),
    );

    expect(result.statusCode).toBe(200);
    expect(mockedListExams).toHaveBeenCalledWith({
      status: 'GENERATING',
      provider: 'aws',
      certificationId: certification.id,
      limit: 10,
      cursor: 'c3RhcnRLZXk=',
    });
  });

  it('returns 400 Bad Request for invalid query params', async () => {
    mockedGetUser.mockResolvedValue(adminUser);

    const result = await handler(makeEvent('GET', '/v1/admin/exams', undefined, { limit: 'no' }));
    const body = JSON.parse(result.body ?? '{}') as { error: string };

    expect(result.statusCode).toBe(400);
    expect(body.error).toBe('InvalidRequest');
    expect(mockedListExams).not.toHaveBeenCalled();
  });

  it('returns 403 Forbidden for a customer', async () => {
    const result = await handler(makeEvent('GET', '/v1/admin/exams'));
    const body = JSON.parse(result.body ?? '{}') as { error: string };

    expect(result.statusCode).toBe(403);
    expect(body.error).toBe('Forbidden');
    expect(mockedListExams).not.toHaveBeenCalled();
  });
});

describe('GET /v1/admin/exams/{id}', () => {
  it('returns the full exam for an exam owned by another user', async () => {
    mockedGetUser.mockResolvedValue(adminUser);
    mockedGetExam.mockResolvedValue(otherUserExam);
    mockedGetCanonicalExam.mockResolvedValue({ ...fullExam, id: otherUserExam.id });

    const result = await handler(makeEvent('GET', `/v1/admin/exams/${otherUserExam.id}`));
    const body = JSON.parse(result.body ?? '{}') as { id: string; schemaVersion: string };

    expect(result.statusCode).toBe(200);
    expect(body.id).toBe(otherUserExam.id);
    expect(body.schemaVersion).toBe('1.0.0');
    expect(mockedGetCanonicalExam).toHaveBeenCalledWith(otherUserExam.s3KeyJson);
  });

  it('returns 409 ExamNotReady while the exam is GENERATING', async () => {
    mockedGetUser.mockResolvedValue(adminUser);
    mockedGetExam.mockResolvedValue({ ...generatingExam, ownerId: 'sub-bob' });

    const result = await handler(makeEvent('GET', `/v1/admin/exams/${generatingExam.id}`));
    const body = JSON.parse(result.body ?? '{}') as { error: string };

    expect(result.statusCode).toBe(409);
    expect(body.error).toBe('ExamNotReady');
    expect(mockedGetCanonicalExam).not.toHaveBeenCalled();
  });

  it('returns 404 ExamNotFound for an unknown exam', async () => {
    mockedGetUser.mockResolvedValue(adminUser);
    mockedGetExam.mockResolvedValue(null);

    const result = await handler(makeEvent('GET', `/v1/admin/exams/${examId}`));
    const body = JSON.parse(result.body ?? '{}') as { error: string };

    expect(result.statusCode).toBe(404);
    expect(body.error).toBe('ExamNotFound');
  });

  it('returns 403 Forbidden for a customer', async () => {
    mockedGetExam.mockResolvedValue(otherUserExam);

    const result = await handler(makeEvent('GET', `/v1/admin/exams/${otherUserExam.id}`));
    const body = JSON.parse(result.body ?? '{}') as { error: string };

    expect(result.statusCode).toBe(403);
    expect(body.error).toBe('Forbidden');
    expect(mockedGetCanonicalExam).not.toHaveBeenCalled();
  });
});

describe('GET /v1/admin/exams/{id}/status', () => {
  it('returns the status payload for an exam owned by another user', async () => {
    mockedGetUser.mockResolvedValue(adminUser);
    mockedGetExam.mockResolvedValue(otherUserExam);

    const result = await handler(makeEvent('GET', `/v1/admin/exams/${otherUserExam.id}/status`));
    const body = JSON.parse(result.body ?? '{}') as {
      id: string;
      status: string;
      createdAt: string;
    };

    expect(result.statusCode).toBe(200);
    expect(body.id).toBe(otherUserExam.id);
    expect(body.status).toBe('READY');
    expect(body.createdAt).toBe(otherUserExam.createdAt);
  });

  it('returns 403 Forbidden for a customer', async () => {
    mockedGetExam.mockResolvedValue(otherUserExam);

    const result = await handler(makeEvent('GET', `/v1/admin/exams/${otherUserExam.id}/status`));
    const body = JSON.parse(result.body ?? '{}') as { error: string };

    expect(result.statusCode).toBe(403);
    expect(body.error).toBe('Forbidden');
  });
});

describe('GET /v1/admin/exams/{id}/download', () => {
  it('returns a presigned URL for an exam owned by another user', async () => {
    const downloadUrl = 'https://s3.example.com/presigned';
    const expiresAt = '2026-07-31T12:10:00.000Z';
    mockedGetUser.mockResolvedValue(adminUser);
    mockedGetExam.mockResolvedValue(otherUserExam);
    mockedGetPresignedDownloadUrl.mockResolvedValue({ url: downloadUrl, expiresAt });

    const result = await handler(makeEvent('GET', `/v1/admin/exams/${otherUserExam.id}/download`));
    const body = JSON.parse(result.body ?? '{}') as { downloadUrl: string; expiresAt: string };

    expect(result.statusCode).toBe(200);
    expect(body.downloadUrl).toBe(downloadUrl);
    expect(body.expiresAt).toBe(expiresAt);
    expect(mockedGetPresignedDownloadUrl).toHaveBeenCalledWith(otherUserExam.s3KeyPdf);
  });

  it('returns 403 Forbidden for a customer', async () => {
    mockedGetExam.mockResolvedValue(otherUserExam);

    const result = await handler(makeEvent('GET', `/v1/admin/exams/${otherUserExam.id}/download`));
    const body = JSON.parse(result.body ?? '{}') as { error: string };

    expect(result.statusCode).toBe(403);
    expect(body.error).toBe('Forbidden');
    expect(mockedGetPresignedDownloadUrl).not.toHaveBeenCalled();
  });
});

describe('DELETE /v1/admin/exams/{id}', () => {
  it('deletes an exam owned by another user', async () => {
    mockedGetUser.mockResolvedValue(adminUser);
    mockedGetExam.mockResolvedValue(otherUserExam);
    mockedDeleteArtifacts.mockResolvedValue(undefined);
    mockedDeleteExam.mockResolvedValue(undefined);

    const result = await handler(makeEvent('DELETE', `/v1/admin/exams/${otherUserExam.id}`));

    expect(result.statusCode).toBe(204);
    expect(mockedDeleteArtifacts).toHaveBeenCalledWith([
      otherUserExam.s3KeyJson,
      otherUserExam.s3KeyPdf,
    ]);
    expect(mockedDeleteExam).toHaveBeenCalledWith(otherUserExam.id);
  });

  it('returns 403 Forbidden for a customer', async () => {
    mockedGetExam.mockResolvedValue(otherUserExam);

    const result = await handler(makeEvent('DELETE', `/v1/admin/exams/${otherUserExam.id}`));
    const body = JSON.parse(result.body ?? '{}') as { error: string };

    expect(result.statusCode).toBe(403);
    expect(body.error).toBe('Forbidden');
    expect(mockedDeleteArtifacts).not.toHaveBeenCalled();
    expect(mockedDeleteExam).not.toHaveBeenCalled();
  });
});

describe('POST /v1/admin/exams', () => {
  it('returns 404 Not Found (admins generate exams via POST /v1/exams)', async () => {
    mockedGetUser.mockResolvedValue(adminUser);

    const result = await handler(
      makeEvent('POST', '/v1/admin/exams', { certificationId: certification.id }),
    );
    const body = JSON.parse(result.body ?? '{}') as { error: string };

    expect(result.statusCode).toBe(404);
    expect(body.error).toBe('NotFound');
  });
});

describe('GET /v1/admin/users', () => {
  it('returns a paginated list of users for an admin', async () => {
    mockedGetUser.mockResolvedValue(adminUser);
    mockedListUsers.mockResolvedValue({
      users: [currentUser, targetUser],
      nextCursor: 'c3RhcnRLZXk=',
    });

    const result = await handler(makeEvent('GET', '/v1/admin/users'));
    const body = JSON.parse(result.body ?? '{}') as {
      items: unknown[];
      cursor: { nextCursor: string | null; hasNextPage: boolean };
    };

    expect(result.statusCode).toBe(200);
    expect(body.items).toEqual([currentUser, targetUser]);
    expect(body.cursor).toEqual({ nextCursor: 'c3RhcnRLZXk=', hasNextPage: true });
    expect(mockedListUsers).toHaveBeenCalledWith({ limit: 20 });
  });

  it('passes through email, sub, limit, and cursor query params', async () => {
    mockedGetUser.mockResolvedValue(adminUser);
    mockedListUsers.mockResolvedValue({ users: [targetUser] });

    const result = await handler(
      makeEvent('GET', '/v1/admin/users', undefined, {
        email: 'bob@',
        limit: '5',
        cursor: 'c3RhcnRLZXk=',
      }),
    );

    expect(result.statusCode).toBe(200);
    expect(mockedListUsers).toHaveBeenCalledWith({
      email: 'bob@',
      limit: 5,
      cursor: 'c3RhcnRLZXk=',
    });
  });

  it('searches by sub', async () => {
    mockedGetUser.mockResolvedValue(adminUser);
    mockedListUsers.mockResolvedValue({ users: [targetUser] });

    const result = await handler(
      makeEvent('GET', '/v1/admin/users', undefined, { sub: targetUser.userId }),
    );

    expect(result.statusCode).toBe(200);
    expect(mockedListUsers).toHaveBeenCalledWith({ sub: targetUser.userId, limit: 20 });
  });

  it('returns 400 Bad Request for invalid query params', async () => {
    mockedGetUser.mockResolvedValue(adminUser);

    const result = await handler(makeEvent('GET', '/v1/admin/users', undefined, { limit: 'no' }));
    const body = JSON.parse(result.body ?? '{}') as { error: string };

    expect(result.statusCode).toBe(400);
    expect(body.error).toBe('InvalidRequest');
    expect(mockedListUsers).not.toHaveBeenCalled();
  });

  it('returns 403 Forbidden for a customer', async () => {
    const result = await handler(makeEvent('GET', '/v1/admin/users'));
    const body = JSON.parse(result.body ?? '{}') as { error: string };

    expect(result.statusCode).toBe(403);
    expect(body.error).toBe('Forbidden');
    expect(mockedListUsers).not.toHaveBeenCalled();
  });
});

describe('PUT /v1/admin/users/{id}/role', () => {
  it('sets the role and returns the updated user', async () => {
    mockedGetUser.mockResolvedValue(adminUser);
    mockedUpdateUserRole.mockResolvedValue({ ...targetUser, role: 'admin' });

    const result = await handler(
      makeEvent('PUT', `/v1/admin/users/${targetUser.userId}/role`, { role: 'admin' }),
    );
    const body = JSON.parse(result.body ?? '{}') as { userId: string; role: string };

    expect(result.statusCode).toBe(200);
    expect(body.userId).toBe(targetUser.userId);
    expect(body.role).toBe('admin');
    expect(mockedUpdateUserRole).toHaveBeenCalledWith(targetUser.userId, 'admin');
  });

  it('returns 400 Bad Request for an invalid role', async () => {
    mockedGetUser.mockResolvedValue(adminUser);

    const result = await handler(
      makeEvent('PUT', `/v1/admin/users/${targetUser.userId}/role`, { role: 'superuser' }),
    );
    const body = JSON.parse(result.body ?? '{}') as { error: string };

    expect(result.statusCode).toBe(400);
    expect(body.error).toBe('InvalidRequest');
    expect(mockedUpdateUserRole).not.toHaveBeenCalled();
  });

  it('returns 404 Not Found for an unknown user', async () => {
    mockedGetUser.mockResolvedValue(adminUser);
    mockedUpdateUserRole.mockResolvedValue(null);

    const result = await handler(
      makeEvent('PUT', `/v1/admin/users/unknown/role`, { role: 'admin' }),
    );
    const body = JSON.parse(result.body ?? '{}') as { error: string };

    expect(result.statusCode).toBe(404);
    expect(body.error).toBe('NotFound');
  });

  it('returns 403 Forbidden for a customer', async () => {
    const result = await handler(
      makeEvent('PUT', `/v1/admin/users/${targetUser.userId}/role`, { role: 'admin' }),
    );
    const body = JSON.parse(result.body ?? '{}') as { error: string };

    expect(result.statusCode).toBe(403);
    expect(body.error).toBe('Forbidden');
    expect(mockedUpdateUserRole).not.toHaveBeenCalled();
  });
});