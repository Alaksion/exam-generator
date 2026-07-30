import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SQSEvent } from 'aws-lambda';
import { handler, buildArtifactKeys, STUB_SCHEMA_VERSION, STUB_PDF_CONTENT } from './index.js';
import { getExamById, updateExamStatus } from '../shared/repositories/exams.js';
import { getCertificationById } from '../shared/repositories/certifications.js';
import { generateExamQuestions } from '../shared/services/bedrock.js';
import { parseExamQuestions } from '../shared/services/questionParser.js';
import { certification } from '../test/fixtures/certification.js';
import { Exam } from '../shared/types.js';

vi.mock('../shared/repositories/exams.js', () => ({
  getExamById: vi.fn(),
  updateExamStatus: vi.fn(),
}));

vi.mock('../shared/repositories/certifications.js', () => ({
  getCertificationById: vi.fn(),
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(() => ({ send: vi.fn() })),
  PutObjectCommand: vi.fn((input: unknown) => input),
}));

vi.mock('../shared/services/bedrock.js', () => ({
  generateExamQuestions: vi.fn(),
  buildQuestionContexts: vi.fn(() => []),
  regenerateQuestion: vi.fn(),
}));

vi.mock('../shared/services/questionParser.js', () => ({
  parseExamQuestions: vi.fn(),
}));

const mockedGetExam = vi.mocked(getExamById);
const mockedUpdateExam = vi.mocked(updateExamStatus);
const mockedGetCert = vi.mocked(getCertificationById);
const mockedGenerateExamQuestions = vi.mocked(generateExamQuestions);
const mockedParseExamQuestions = vi.mocked(parseExamQuestions);

const examId = '22222222-2222-2222-2222-222222222222';
const correlationId = '33333333-3333-3333-3333-333333333333';
const keys = buildArtifactKeys(examId);

const generatingExam: Exam = {
  id: examId,
  certificationId: certification.id,
  provider: certification.provider,
  title: 'AWS Certified Cloud Practitioner - Practice Exam 2026-07-28T12:00:00.000Z',
  status: 'GENERATING',
  createdAt: '2026-07-28T12:00:00.000Z',
  finishedAt: null,
  s3KeyJson: undefined,
  s3KeyPdf: undefined,
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
});

const sampleQuestion = {
  id: 'question-1',
  number: 1,
  domain: 'Cloud Concepts',
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
  it('processes a GENERATING exam and marks it READY with artifacts', async () => {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    mockedGetExam.mockResolvedValue(generatingExam);
    mockedGetCert.mockResolvedValue(certification);
    mockedGenerateExamQuestions.mockResolvedValue(['raw question']);
    mockedParseExamQuestions.mockResolvedValue([sampleQuestion]);

    await handler(makeEvent({ examId, certificationId: certification.id, correlationId }));

    expect(mockedGenerateExamQuestions).toHaveBeenCalledWith(generatingExam, certification, correlationId);
    expect(mockedParseExamQuestions).toHaveBeenCalled();

    expect(mockedUpdateExam).toHaveBeenCalledWith(
      examId,
      'READY',
      expect.objectContaining({
        s3KeyJson: keys.s3KeyJson,
        s3KeyPdf: keys.s3KeyPdf,
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
    expect(jsonBody.schemaVersion).toBe(STUB_SCHEMA_VERSION);
    expect(jsonBody.status).toBe('READY');
    expect(jsonBody.questions).toEqual([sampleQuestion]);
    expect(jsonBody.s3KeyJson).toBe(keys.s3KeyJson);

    const pdfCall = mockedCommand.mock.calls.find(
      (call) => (call[0] as { Key: string }).Key === keys.s3KeyPdf,
    );
    expect(pdfCall).toBeDefined();
    const pdfBody = (pdfCall![0] as { Body: Buffer }).Body;
    expect(pdfBody.toString()).toBe(STUB_PDF_CONTENT);
  });

  it('marks the exam FAILED when question parsing fails after retry', async () => {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    mockedGetExam.mockResolvedValue(generatingExam);
    mockedGetCert.mockResolvedValue(certification);
    mockedGenerateExamQuestions.mockResolvedValue(['raw question']);
    mockedParseExamQuestions.mockResolvedValue(null);

    await handler(makeEvent({ examId, certificationId: certification.id, correlationId }));

    expect(mockedUpdateExam).toHaveBeenCalledWith(examId, 'FAILED', expect.any(Object));

    const finishedAt = (mockedUpdateExam.mock.calls[0][2] as { finishedAt: string }).finishedAt;
    expect(finishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(vi.mocked(PutObjectCommand)).not.toHaveBeenCalled();
  });

  it('skips already processed exams', async () => {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    mockedGetExam.mockResolvedValue({ ...generatingExam, status: 'READY' });

    await handler(makeEvent({ examId, certificationId: certification.id, correlationId }));

    expect(mockedUpdateExam).not.toHaveBeenCalled();
    expect(vi.mocked(PutObjectCommand)).not.toHaveBeenCalled();
  });

  it('skips when exam is not found', async () => {
    mockedGetExam.mockResolvedValue(null);

    await handler(makeEvent({ examId, certificationId: certification.id, correlationId }));

    expect(mockedUpdateExam).not.toHaveBeenCalled();
  });

  it('skips when certification is not found', async () => {
    mockedGetExam.mockResolvedValue(generatingExam);
    mockedGetCert.mockResolvedValue(null);

    await handler(makeEvent({ examId, certificationId: certification.id, correlationId }));

    expect(mockedUpdateExam).not.toHaveBeenCalled();
  });
});
