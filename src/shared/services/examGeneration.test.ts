import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Exam } from '../types.js';
import { NotFoundError } from '../errors.js';
import { getCertificationById } from '../repositories/certifications.js';
import { createExam as createExamRecord } from '../repositories/exams.js';
import {
  sendGeneratorMessage,
  requestExamGeneration,
  toCreatedExamResponse,
} from './examGeneration.js';
import { certification } from '../../test/fixtures/certification.js';

vi.mock('../repositories/certifications.js', () => ({
  getCertificationById: vi.fn(),
}));

vi.mock('../repositories/exams.js', () => ({
  createExam: vi.fn(),
}));

vi.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: vi.fn(() => ({ send: vi.fn() })),
  SendMessageCommand: vi.fn((input: unknown) => input),
}));

describe('sendGeneratorMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('validates and sends the message to the SQS queue', async () => {
    const { SendMessageCommand } = await import('@aws-sdk/client-sqs');
    const message = {
      examId: '11111111-1111-1111-1111-111111111111',
      certificationId: '22222222-2222-2222-2222-222222222222',
      correlationId: 'corr-123',
    };

    await sendGeneratorMessage(message);

    const mockedCommand = vi.mocked(SendMessageCommand);
    expect(mockedCommand).toHaveBeenCalledOnce();
    const sent = mockedCommand.mock.calls[0][0] as { MessageBody: string };
    expect(JSON.parse(sent.MessageBody)).toEqual(message);
  });
});

describe('requestExamGeneration', () => {
  const now = new Date('2026-07-28T12:00:00.000Z');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates an exam, persists it, and sends a generator message', async () => {
    const { SendMessageCommand } = await import('@aws-sdk/client-sqs');
    vi.mocked(getCertificationById).mockResolvedValue(certification);
    vi.mocked(createExamRecord).mockResolvedValue(undefined);

    const exam = await requestExamGeneration(certification.id, now);

    expect(exam.certificationId).toBe(certification.id);
    expect(exam.status).toBe('GENERATING');
    expect(createExamRecord).toHaveBeenCalledWith(exam);

    const mockedCommand = vi.mocked(SendMessageCommand);
    expect(mockedCommand).toHaveBeenCalledOnce();
    const sent = mockedCommand.mock.calls[0][0] as unknown as { MessageBody: string };
    const message = JSON.parse(sent.MessageBody) as {
      examId: string;
      certificationId: string;
      correlationId: string;
    };
    expect(message.examId).toBe(exam.id);
    expect(message.certificationId).toBe(certification.id);
    expect(message.correlationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('throws NotFoundError when certification is unknown', async () => {
    vi.mocked(getCertificationById).mockResolvedValue(null);

    await expect(requestExamGeneration(certification.id, now)).rejects.toThrow(NotFoundError);
    expect(createExamRecord).not.toHaveBeenCalled();
  });

  it('throws NotFoundError when certification is inactive', async () => {
    vi.mocked(getCertificationById).mockResolvedValue({ ...certification, isActive: false });

    await expect(requestExamGeneration(certification.id, now)).rejects.toThrow(NotFoundError);
    expect(createExamRecord).not.toHaveBeenCalled();
  });
});

describe('toCreatedExamResponse', () => {
  it('returns the public exam response shape', () => {
    const createdExam = {
      id: '11111111-1111-1111-1111-111111111111',
      certificationId: certification.id,
      provider: certification.provider,
      title: 'AWS Certified Cloud Practitioner - Practice Exam 2026-07-28T12:00:00.000Z',
      status: 'GENERATING' as const,
      createdAt: '2026-07-28T12:00:00.000Z',
      finishedAt: null,
      s3KeyJson: undefined,
      s3KeyPdf: undefined,
    } as Exam;

    const response = toCreatedExamResponse(createdExam);

    expect(response).toEqual({
      id: createdExam.id,
      status: createdExam.status,
    });
  });
});
