import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SQSEvent } from 'aws-lambda';
import { handler, buildArtifactKeys, CANONICAL_EXAM_SCHEMA_VERSION } from './index.js';
import { getExamById, updateExamStatus } from '../data/datasources/exams.js';
import { getCertificationById } from '../services/certificationService.js';
import {
  generateExamQuestions,
  generateExamQuestionsV2,
} from '../services/bedrockService.js';
import { parseExamQuestions } from '../services/questionParserService.js';
import { renderExamPdf } from '../services/pdfService.js';
import { putArtifact } from '../data/datasources/artifacts.js';
import { certification } from '../test/fixtures/certification.js';

vi.mock('../data/datasources/exams.js', () => ({
  getExamById: vi.fn(),
  updateExamStatus: vi.fn(),
  createExam: vi.fn(),
  listExams: vi.fn(),
  deleteExam: vi.fn(),
}));

vi.mock('../services/certificationService.js', () => ({
  getCertificationById: vi.fn(),
  listCertifications: vi.fn(),
  createCertification: vi.fn(),
  updateCertificationById: vi.fn(),
}));

vi.mock('../data/datasources/artifacts.js', () => ({
  putArtifact: vi.fn(),
  getCanonicalExam: vi.fn(),
  getPresignedDownloadUrl: vi.fn(),
  deleteArtifacts: vi.fn(),
}));

vi.mock('../services/bedrockService.js', () => ({
  generateExamQuestions: vi.fn(),
  generateExamQuestionsV2: vi.fn(),
  buildQuestionContexts: vi.fn(() => []),
  regenerateQuestion: vi.fn(),
}));

vi.mock('../services/questionParserService.js', () => ({
  parseExamQuestions: vi.fn(),
}));

vi.mock('../services/pdfService.js', () => ({
  renderExamPdf: vi.fn(),
}));

const mockedGetExam = vi.mocked(getExamById);
const mockedUpdateExam = vi.mocked(updateExamStatus);
const mockedGetCert = vi.mocked(getCertificationById);
const mockedGenerateExamQuestions = vi.mocked(generateExamQuestions);
const mockedGenerateExamQuestionsV2 = vi.mocked(generateExamQuestionsV2);
const mockedParseExamQuestions = vi.mocked(parseExamQuestions);
const mockedRenderExamPdf = vi.mocked(renderExamPdf);
const mockedPutArtifact = vi.mocked(putArtifact);

const examId = '22222222-2222-2222-2222-222222222222';
const correlationId = '33333333-3333-3333-3333-333333333333';
const keys = buildArtifactKeys(examId);

const pendingExam = {
  id: examId,
  certificationId: certification.id,
  ownerId: 'sub-alice',
  provider: certification.provider,
  title: 'AWS Certified Cloud Practitioner - Practice Exam 2026-07-28T12:00:00.000Z',
  status: 'PENDING' as const,
  createdAt: '2026-07-28T12:00:00.000Z',
  finishedAt: null,
  s3KeyJson: undefined,
  s3KeyPdf: undefined,
};

const claimedExam = {
  ...pendingExam,
  status: 'GENERATING' as const,
};

function makeEvent(message: object): SQSEvent {
  return {
    Records: [
      {
        messageId: 'msg-1',
        receiptHandle: 'receipt',
        body: JSON.stringify(message),
        attributes: {
          ApproximateReceiveCount: '1',
          SentTimestamp: '1',
          SenderId: 'sender',
          ApproximateFirstReceiveTimestamp: '1',
        },
        messageAttributes: {},
        md5OfBody: 'md5',
        eventSource: 'aws:sqs',
        eventSourceARN: 'arn:aws:sqs:us-east-1:123456789:queue',
        awsRegion: 'us-east-1',
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedUpdateExam.mockResolvedValue(true);
  mockedPutArtifact.mockResolvedValue(undefined);
  delete process.env.EXAM_GENERATION_V2;
});

afterEach(() => {
  delete process.env.EXAM_GENERATION_V2;
});

const sampleQuestion = {
  id: 'question-1',
  number: 1,
  domain: 'Cloud Concepts',
  domainId: '22222222-2222-2222-2222-222222222222',
  topic: 'Amazon S3',
  topicId: '33333333-3333-3333-3333-333333333333',
  difficulty: 'medium' as const,
  text: 'Which AWS service provides object storage?',
  options: [
    { id: 'option-1', label: 'A', text: 'Amazon S3', isCorrect: true },
    { id: 'option-2', label: 'B', text: 'Amazon EC2', isCorrect: false },
  ],
  explanation: 'Amazon S3 is object storage.',
  reference: 'https://docs.aws.amazon.com/s3/',
};

describe('generator handler', () => {
  it('claims a PENDING exam and marks it READY with artifacts', async () => {
    mockedGetExam.mockResolvedValue(pendingExam);
    mockedGetCert.mockResolvedValue(certification);
    mockedGenerateExamQuestions.mockResolvedValue(['raw question']);
    mockedParseExamQuestions.mockResolvedValue([sampleQuestion]);
    const pdfBytes = Buffer.from('mock-pdf-bytes');
    mockedRenderExamPdf.mockResolvedValue(pdfBytes);

    await handler(makeEvent({ examId, certificationId: certification.id, correlationId }));

    expect(mockedUpdateExam).toHaveBeenCalledWith(examId, 'GENERATING', {}, 'PENDING');
    expect(mockedGenerateExamQuestions).toHaveBeenCalledWith(claimedExam, certification, correlationId);
    expect(mockedParseExamQuestions).toHaveBeenCalled();

    expect(mockedUpdateExam).toHaveBeenCalledWith(
      examId,
      'READY',
      expect.objectContaining({
        s3KeyJson: keys.s3KeyJson,
        s3KeyPdf: keys.s3KeyPdf,
      }),
    );

    expect(mockedRenderExamPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        schemaVersion: CANONICAL_EXAM_SCHEMA_VERSION,
        status: 'READY',
        questions: [sampleQuestion],
      }),
    );

    expect(mockedPutArtifact).toHaveBeenCalledWith(keys.s3KeyRaw, JSON.stringify(['raw question']), 'application/json');
    expect(mockedPutArtifact).toHaveBeenCalledWith(
      keys.s3KeyJson,
      expect.any(String),
      'application/json',
    );
    expect(mockedPutArtifact).toHaveBeenCalledWith(keys.s3KeyPdf, pdfBytes, 'application/pdf');

    const jsonCall = mockedPutArtifact.mock.calls.find((call) => call[0] === keys.s3KeyJson);
    const jsonBody = JSON.parse(jsonCall![1] as string) as {
      schemaVersion: string;
      status: string;
      questions: unknown[];
      s3KeyJson: string;
    };
    expect(jsonBody.schemaVersion).toBe(CANONICAL_EXAM_SCHEMA_VERSION);
    expect(jsonBody.status).toBe('READY');
    expect(jsonBody.questions).toEqual([sampleQuestion]);
    expect(jsonBody.s3KeyJson).toBe(keys.s3KeyJson);
  });

  it('marks the exam FAILED when question parsing fails after retry', async () => {
    mockedGetExam.mockResolvedValue(pendingExam);
    mockedGetCert.mockResolvedValue(certification);
    mockedGenerateExamQuestions.mockResolvedValue(['raw question']);
    mockedParseExamQuestions.mockResolvedValue(null);

    await handler(makeEvent({ examId, certificationId: certification.id, correlationId }));

    expect(mockedUpdateExam).toHaveBeenCalledWith(examId, 'GENERATING', {}, 'PENDING');
    expect(mockedUpdateExam).toHaveBeenCalledWith(examId, 'FAILED', expect.any(Object));

    const failedCall = mockedUpdateExam.mock.calls.find((call) => call[1] === 'FAILED');
    const finishedAt = (failedCall![2] as { finishedAt: string }).finishedAt;
    expect(finishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(mockedPutArtifact).not.toHaveBeenCalled();
  });

  it('aborts when the exam is already GENERATING (duplicate/in-flight)', async () => {
    mockedGetExam.mockResolvedValue(claimedExam);

    await handler(makeEvent({ examId, certificationId: certification.id, correlationId }));

    expect(mockedUpdateExam).not.toHaveBeenCalled();
    expect(mockedGenerateExamQuestions).not.toHaveBeenCalled();
    expect(mockedPutArtifact).not.toHaveBeenCalled();
  });

  it('skips already processed exams', async () => {
    mockedGetExam.mockResolvedValue({ ...pendingExam, status: 'READY' });

    await handler(makeEvent({ examId, certificationId: certification.id, correlationId }));

    expect(mockedUpdateExam).not.toHaveBeenCalled();
    expect(mockedPutArtifact).not.toHaveBeenCalled();
  });

  it('skips when exam is not found', async () => {
    mockedGetExam.mockResolvedValue(null);

    await handler(makeEvent({ examId, certificationId: certification.id, correlationId }));

    expect(mockedUpdateExam).not.toHaveBeenCalled();
  });

  it('aborts when the claim fails (another worker already generating)', async () => {
    mockedGetExam.mockResolvedValue(pendingExam);
    mockedUpdateExam.mockResolvedValue(false);

    await handler(makeEvent({ examId, certificationId: certification.id, correlationId }));

    expect(mockedUpdateExam).toHaveBeenCalledWith(examId, 'GENERATING', {}, 'PENDING');
    expect(mockedGenerateExamQuestions).not.toHaveBeenCalled();
    expect(mockedPutArtifact).not.toHaveBeenCalled();
  });

  it('marks the exam FAILED when the certification is not found', async () => {
    mockedGetExam.mockResolvedValue(pendingExam);
    mockedGetCert.mockResolvedValue(null);

    await handler(makeEvent({ examId, certificationId: certification.id, correlationId }));

    expect(mockedUpdateExam).toHaveBeenCalledWith(examId, 'GENERATING', {}, 'PENDING');
    expect(mockedUpdateExam).toHaveBeenCalledWith(examId, 'FAILED', expect.any(Object));
    expect(mockedGenerateExamQuestions).not.toHaveBeenCalled();
    expect(mockedPutArtifact).not.toHaveBeenCalled();
  });

  it('marks the exam FAILED when question generation throws', async () => {
    mockedGetExam.mockResolvedValue(pendingExam);
    mockedGetCert.mockResolvedValue(certification);
    mockedGenerateExamQuestions.mockRejectedValue(new Error('Bedrock throttled'));

    await handler(makeEvent({ examId, certificationId: certification.id, correlationId }));

    expect(mockedUpdateExam).toHaveBeenCalledWith(examId, 'GENERATING', {}, 'PENDING');
    expect(mockedUpdateExam).toHaveBeenCalledWith(examId, 'FAILED', expect.any(Object));
    expect(mockedPutArtifact).not.toHaveBeenCalled();
  });

  it('marks the exam FAILED when artifact upload or PDF render throws', async () => {
    mockedGetExam.mockResolvedValue(pendingExam);
    mockedGetCert.mockResolvedValue(certification);
    mockedGenerateExamQuestions.mockResolvedValue(['raw question']);
    mockedParseExamQuestions.mockResolvedValue([sampleQuestion]);
    mockedRenderExamPdf.mockRejectedValue(new Error('PDF render failed'));

    await handler(makeEvent({ examId, certificationId: certification.id, correlationId }));

    expect(mockedUpdateExam).toHaveBeenCalledWith(examId, 'GENERATING', {}, 'PENDING');
    expect(mockedUpdateExam).toHaveBeenCalledWith(examId, 'FAILED', expect.any(Object));

    const failedCall = mockedUpdateExam.mock.calls.find((call) => call[1] === 'FAILED');
    const finishedAt = (failedCall![2] as { finishedAt: string }).finishedAt;
    expect(finishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('skips exams already in a FAILED terminal state', async () => {
    mockedGetExam.mockResolvedValue({
      ...pendingExam,
      status: 'FAILED',
      finishedAt: '2026-07-28T12:00:05.000Z',
    });

    await handler(makeEvent({ examId, certificationId: certification.id, correlationId }));

    expect(mockedUpdateExam).not.toHaveBeenCalled();
    expect(mockedPutArtifact).not.toHaveBeenCalled();
  });

  it('routes to the V2 flow when EXAM_GENERATION_V2 is on', async () => {
    process.env.EXAM_GENERATION_V2 = 'true';
    const contexts = [
      {
        number: 1,
        difficulty: 'medium' as const,
        domain: 'Cloud Concepts',
        domainId: '22222222-2222-2222-2222-222222222222',
        topic: 'Amazon S3',
        topicId: '33333333-3333-3333-3333-333333333333',
        topicContext: certification.config.domains[0].topics[0].context,
        concept: 'lifecycle transitions',
      },
    ];
    const pdfBytes = Buffer.from('mock-pdf-bytes');
    mockedGetExam.mockResolvedValue(pendingExam);
    mockedGetCert.mockResolvedValue(certification);
    mockedGenerateExamQuestionsV2.mockResolvedValue({
      rawResponses: ['raw-response'],
      contexts,
      plan: [{ number: 1, concept: 'lifecycle transitions' }],
    });
    mockedParseExamQuestions.mockResolvedValue([sampleQuestion]);
    mockedRenderExamPdf.mockResolvedValue(pdfBytes);

    await handler(makeEvent({ examId, certificationId: certification.id, correlationId }));

    expect(mockedGenerateExamQuestionsV2).toHaveBeenCalledWith(
      claimedExam,
      certification,
      correlationId,
    );
    expect(mockedGenerateExamQuestions).not.toHaveBeenCalled();
    expect(mockedParseExamQuestions).toHaveBeenCalledWith(['raw-response'], contexts, expect.any(Function));
    expect(mockedUpdateExam).toHaveBeenCalledWith(examId, 'READY', expect.any(Object));

    expect(mockedPutArtifact).toHaveBeenCalledWith(
      keys.s3KeyPlan,
      JSON.stringify([{ number: 1, concept: 'lifecycle transitions' }]),
      'application/json',
    );

    const jsonCall = mockedPutArtifact.mock.calls.find((call) => call[0] === keys.s3KeyJson);
    const jsonBody = JSON.parse(jsonCall![1] as string) as { schemaVersion: string };
    expect(jsonBody.schemaVersion).toBe('3.0.0');
  });

  it('keeps the flag-off path byte-for-byte unchanged (schemaVersion 2.0.0, no plan.json)', async () => {
    mockedGetExam.mockResolvedValue(pendingExam);
    mockedGetCert.mockResolvedValue(certification);
    mockedGenerateExamQuestions.mockResolvedValue(['raw question']);
    mockedParseExamQuestions.mockResolvedValue([sampleQuestion]);
    mockedRenderExamPdf.mockResolvedValue(Buffer.from('mock-pdf-bytes'));

    await handler(makeEvent({ examId, certificationId: certification.id, correlationId }));

    const planCall = mockedPutArtifact.mock.calls.find((call) => call[0] === keys.s3KeyPlan);
    expect(planCall).toBeUndefined();

    const jsonCall = mockedPutArtifact.mock.calls.find((call) => call[0] === keys.s3KeyJson);
    const jsonBody = JSON.parse(jsonCall![1] as string) as { schemaVersion: string };
    expect(jsonBody.schemaVersion).toBe(CANONICAL_EXAM_SCHEMA_VERSION);
  });
});