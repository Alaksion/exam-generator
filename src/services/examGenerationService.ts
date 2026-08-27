import { v4 as uuidv4 } from 'uuid';
import { sendGeneratorMessage } from '../data/datasources/generatorQueue.js';
import { createExam as createExamRecord } from '../data/datasources/exams.js';
import { NotFoundError } from './errors.js';
import { getCertificationById } from './certificationService.js';
import { createExam } from './examService.js';
import { type CreatedExamView, type Exam } from './model.js';

export async function requestExamGeneration(
  certificationId: string,
  ownerId: string,
  now = new Date(),
): Promise<Exam> {
  const certification = await getCertificationById(certificationId);
  if (!certification || !certification.isActive) {
    throw new NotFoundError('Certification');
  }

  const exam = createExam(certification, ownerId, now);
  await createExamRecord(exam);

  const correlationId = uuidv4();
  await sendGeneratorMessage({
    examId: exam.id,
    certificationId,
    correlationId,
  });

  return exam;
}

export function toCreatedExamResponse(exam: Exam): CreatedExamView {
  return {
    id: exam.id,
    status: exam.status,
  };
}