import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SQSEvent } from 'aws-lambda';
import { handler, buildArtifactKeys, STUB_SCHEMA_VERSION, STUB_PDF_CONTENT } from './index.js';
import { getExamById, updateExamStatus } from '../shared/repositories/exams.js';
import { getCertificationById } from '../shared/repositories/certifications.js';
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

const mockedGetExam = vi.mocked(getExamById);
const mockedUpdateExam = vi.mocked(updateExamStatus);
const mockedGetCert = vi.mocked(getCertificationById);

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

describe('generator handler', () => {
  it('processes a GENERATING exam and marks it READY with artifacts', async () => {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    mockedGetExam.mockResolvedValue(generatingExam);
    mockedGetCert.mockResolvedValue(certification);

    await handler(makeEvent({ examId, certificationId: certification.id, correlationId }));

    expect(mockedUpdateExam).toHaveBeenCalledWith(
      examId,
      'READY',
      expect.objectContaining({
        s3KeyJson: keys.s3KeyJson,
        s3KeyPdf: keys.s3KeyPdf,
      }),
    );

    const finishedAt = (mockedUpdateExam.mock.calls[0][2] as { finishedAt: string }).finishedAt;
    expect(finishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const mockedCommand = vi.mocked(PutObjectCommand);
    expect(mockedCommand).toHaveBeenCalledTimes(2);

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
    expect(jsonBody.questions).toEqual([]);
    expect(jsonBody.s3KeyJson).toBe(keys.s3KeyJson);

    const pdfCall = mockedCommand.mock.calls.find(
      (call) => (call[0] as { Key: string }).Key === keys.s3KeyPdf,
    );
    expect(pdfCall).toBeDefined();
    const pdfBody = (pdfCall![0] as { Body: Buffer }).Body;
    expect(pdfBody.toString()).toBe(STUB_PDF_CONTENT);
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
