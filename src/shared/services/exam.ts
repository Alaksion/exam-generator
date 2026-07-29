import { v4 as uuidv4 } from 'uuid';
import { Certification, Exam, ExamStatus } from '../types.js';
import { InvalidRequestError } from '../errors.js';

export function generateExamTitle(certificationName: string, timestamp: Date): string {
  return `${certificationName} - Practice Exam ${timestamp.toISOString()}`;
}

export function createExam(certification: Certification, now = new Date()): Exam {
  return {
    id: uuidv4(),
    certificationId: certification.id,
    provider: certification.provider,
    title: generateExamTitle(certification.name, now),
    status: 'GENERATING',
    createdAt: now.toISOString(),
    finishedAt: null,
  };
}

export function transitionExamStatus(
  exam: Exam,
  newStatus: Extract<ExamStatus, 'READY' | 'FAILED'>,
  now = new Date(),
): Exam {
  if (exam.status !== 'GENERATING') {
    throw new InvalidRequestError(`Cannot transition exam from ${exam.status} to ${newStatus}.`);
  }

  return {
    ...exam,
    status: newStatus,
    finishedAt: now.toISOString(),
  };
}
