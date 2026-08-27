import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Exam } from './model.js';
import { NotFoundError } from './errors.js';
import { getCertificationById } from './certificationService.js';
import { createExam as createExamRecord } from '../data/datasources/exams.js';
import { sendGeneratorMessage } from '../data/datasources/generatorQueue.js';
import { requestExamGeneration, toCreatedExamResponse } from './examGenerationService.js';
import { certification } from '../test/fixtures/certification.js';

vi.mock('./certificationService.js', () => ({
  getCertificationById: vi.fn(),
}));

vi.mock('../data/datasources/exams.js', () => ({
  createExam: vi.fn(),
}));

vi.mock('../data/datasources/generatorQueue.js', () => ({
  sendGeneratorMessage: vi.fn(),
}));

const mockedSendMessage = vi.mocked(sendGeneratorMessage);

describe('requestExamGeneration', () => {
  const now = new Date('2026-07-28T12:00:00.000Z');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates an exam, persists it, and enqueues a generator message', async () => {
    vi.mocked(getCertificationById).mockResolvedValue(certification);
    vi.mocked(createExamRecord).mockResolvedValue(undefined);

    const exam = await requestExamGeneration(certification.id, 'sub-alice', now);

    expect(exam.certificationId).toBe(certification.id);
    expect(exam.ownerId).toBe('sub-alice');
    expect(exam.status).toBe('PENDING');
    expect(createExamRecord).toHaveBeenCalledWith(exam);

    expect(mockedSendMessage).toHaveBeenCalledOnce();
    const message = mockedSendMessage.mock.calls[0][0];
    expect(message.examId).toBe(exam.id);
    expect(message.certificationId).toBe(certification.id);
    expect(message.correlationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('throws NotFoundError when certification is unknown', async () => {
    vi.mocked(getCertificationById).mockResolvedValue(null);

    await expect(requestExamGeneration(certification.id, 'sub-alice', now)).rejects.toThrow(NotFoundError);
    expect(createExamRecord).not.toHaveBeenCalled();
  });

  it('throws NotFoundError when certification is inactive', async () => {
    vi.mocked(getCertificationById).mockResolvedValue({ ...certification, isActive: false });

    await expect(requestExamGeneration(certification.id, 'sub-alice', now)).rejects.toThrow(NotFoundError);
    expect(createExamRecord).not.toHaveBeenCalled();
  });
});

describe('toCreatedExamResponse', () => {
  it('returns the public exam response shape', () => {
    const createdExam = {
      id: '11111111-1111-1111-1111-111111111111',
      certificationId: certification.id,
      ownerId: 'sub-alice',
      provider: certification.provider,
      title: 'AWS Certified Cloud Practitioner - Practice Exam 2026-07-28T12:00:00.000Z',
      status: 'PENDING' as const,
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