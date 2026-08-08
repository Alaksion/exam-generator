import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SQSEvent } from 'aws-lambda';
import { handler, buildArtifactKeys, CANONICAL_EXAM_SCHEMA_VERSION } from './index.js';
import { getExamById, updateExamStatus } from '../shared/repositories/exams.js';
import { getCertificationById } from '../shared/repositories/certifications.js';
import { generateExamQuestions } from '../shared/services/bedrock.js';
import { parseExamQuestions } from '../shared/services/questionParser.js';
import { renderExamPdf } from '../shared/services/pdfRenderer.js';
import { certification } from '../test/fixtures/certification.js';
import { Exam } from '../shared/types.js';

vi.mock('../shared/repositories/exams.js', () => ({
  getExamById: vi.fn(),
  updateExamStatus: vi.fn(),
}));

vi.mock('../shared/repositories/certifications.js', () => ({
  getCertificationById: vi.fn(),
}));

vi.mock('@aws-sdk/client-s3', () => {
  class MockS3Client {
    send = vi.fn();
  }
  return {
    S3Client: MockS3Client,
    PutObjectCommand: vi.fn(),
  };
});

vi.mock('../shared/services/bedrock.js', () => ({
  generateExamQuestions: vi.fn(),
  buildQuestionContexts: vi.fn(() => []),
  regenerateQuestion: vi.fn(),
}));

vi.mock('../shared/services/questionParser.js', () => ({
  parseExamQuestions: vi.fn(),
}));

vi.mock('../shared/services/pdfRenderer.js', () => ({
  renderExamPdf: vi.fn(),
}));

const mockedGetExam = vi.mocked(getExamById);
const mockedUpdateExam = vi.mocked(updateExamStatus);
const mockedGetCert = vi.mocked(getCertificationById);
const mockedGenerateExamQuestions = vi.mocked(generateExamQuestions);
const mockedParseExamQuestions = vi.mocked(parseExamQuestions);
const mockedRenderExamPdf = vi.mocked(renderExamPdf);

const examId = '22222222-2222-2222-2222-222222222222';
const correlationId = '33333333-3333-3333-3333-333333333333';
const keys = buildArtifactKeys(examId);

const pendingExam: Exam = {
  id: examId,
  certificationId: certification.id,
  provider: certification.provider,
  title: 'AWS Certified Cloud Practitioner - Practice Exam 2026-07-28T12:00:00.000Z',
  status: 'PENDING',
  createdAt: '2026-07-28T12:00:00.000Z',
  finishedAt: null,
  s3KeyJson: undefined,
  s3KeyPdf: undefined,
};

const claimedExam: Exam = {
  ...pendingExam,
  status: 'GENERATING',
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
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
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

    const mockedCommand = vi.mocked(PutObjectCommand);
    expect(mockedCommand).toHaveBeenCalledTimes(3);

    const rawCall = mockedCommand.mock.calls.find(
      (call) => (call[0] as { Key: string }).Key === keys.s3KeyRaw,
    );
    expect(rawCall).toBeDefined();
    const rawBody = JSON.parse((rawCall![0] as { Body: string }).Body) as string[];
    expect(rawBody).toEqual(['raw question']);

    const jsonCall = mockedCommand.mock.calls.find(
      (call) => (call[0] as { Key: string }).Key === keys.s3KeyJson,
    );
    expect(jsonCall).toBeDefined();
    const jsonBody = JSON.parse((jsonCall![0] as { Body: string }).Body) as {
      schemaVersion: string;
      status: string;
      questions: unknown[];
      s3KeyJson: string;
    };
    expect(jsonBody.schemaVersion).toBe(CANONICAL_EXAM_SCHEMA_VERSION);
    expect(jsonBody.status).toBe('READY');
    expect(jsonBody.questions).toEqual([sampleQuestion]);
    expect(jsonBody.s3KeyJson).toBe(keys.s3KeyJson);

    const pdfCall = mockedCommand.mock.calls.find(
      (call) => (call[0] as { Key: string }).Key === keys.s3KeyPdf,
    );
    expect(pdfCall).toBeDefined();
    const pdfBody = (pdfCall![0] as { Body: Buffer }).Body;
    expect(pdfBody).toEqual(pdfBytes);
  });

  it('marks the exam FAILED when question parsing fails after retry', async () => {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
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
    expect(vi.mocked(PutObjectCommand)).not.toHaveBeenCalled();
  });

  it('aborts when the exam is already GENERATING (duplicate/in-flight)', async () => {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    mockedGetExam.mockResolvedValue(claimedExam);

    await handler(makeEvent({ examId, certificationId: certification.id, correlationId }));

    expect(mockedUpdateExam).not.toHaveBeenCalled();
    expect(mockedGenerateExamQuestions).not.toHaveBeenCalled();
    expect(vi.mocked(PutObjectCommand)).not.toHaveBeenCalled();
  });

  it('skips already processed exams', async () => {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    mockedGetExam.mockResolvedValue({ ...pendingExam, status: 'READY' });

    await handler(makeEvent({ examId, certificationId: certification.id, correlationId }));

    expect(mockedUpdateExam).not.toHaveBeenCalled();
    expect(vi.mocked(PutObjectCommand)).not.toHaveBeenCalled();
  });

  it('skips when exam is not found', async () => {
    mockedGetExam.mockResolvedValue(null);

    await handler(makeEvent({ examId, certificationId: certification.id, correlationId }));

    expect(mockedUpdateExam).not.toHaveBeenCalled();
  });

  it('aborts when the claim fails (another worker already generating)', async () => {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    mockedGetExam.mockResolvedValue(pendingExam);
    mockedUpdateExam.mockResolvedValue(false);

    await handler(makeEvent({ examId, certificationId: certification.id, correlationId }));

    expect(mockedUpdateExam).toHaveBeenCalledWith(examId, 'GENERATING', {}, 'PENDING');
    expect(mockedGenerateExamQuestions).not.toHaveBeenCalled();
    expect(vi.mocked(PutObjectCommand)).not.toHaveBeenCalled();
  });

  it('claims the exam but skips when certification is not found', async () => {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    mockedGetExam.mockResolvedValue(pendingExam);
    mockedGetCert.mockResolvedValue(null);

    await handler(makeEvent({ examId, certificationId: certification.id, correlationId }));

    expect(mockedUpdateExam).toHaveBeenCalledWith(examId, 'GENERATING', {}, 'PENDING');
    expect(mockedGenerateExamQuestions).not.toHaveBeenCalled();
    expect(vi.mocked(PutObjectCommand)).not.toHaveBeenCalled();
  });
});
