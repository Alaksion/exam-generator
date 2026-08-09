import { v4 as uuidv4 } from 'uuid';
import { Certification, Exam, ExamStatus } from '../types.js';
import { ConflictError } from '../errors.js';

export function generateExamTitle(certification: Certification, timestamp: Date): string {
  return `${certification.name} - Practice Exam ${timestamp.toISOString()}`;
}

export function createExam(certification: Certification, now = new Date()): Exam {
  return {
    id: uuidv4(),
    certificationId: certification.id,
    provider: certification.provider,
    title: generateExamTitle(certification, now),
    status: 'PENDING',
    createdAt: now.toISOString(),
    finishedAt: null,
    s3KeyJson: undefined,
    s3KeyPdf: undefined,
  };
}

type TransitionTarget = Exclude<ExamStatus, 'PENDING'>;

const NEXT_STATUS: Record<ExamStatus, readonly TransitionTarget[]> = {
  PENDING: ['GENERATING', 'FAILED'],
  GENERATING: ['READY', 'FAILED'],
  READY: [],
  FAILED: [],
};

export function transitionExamStatus(
  exam: Exam,
  newStatus: TransitionTarget,
  now = new Date(),
): Exam {
  if (!NEXT_STATUS[exam.status].includes(newStatus)) {
    throw new ConflictError(`Cannot transition exam from ${exam.status} to ${newStatus}.`);
  }

  const terminal = newStatus === 'READY' || newStatus === 'FAILED';

  return {
    ...exam,
    status: newStatus,
    finishedAt: terminal ? now.toISOString() : exam.finishedAt,
  };
}
