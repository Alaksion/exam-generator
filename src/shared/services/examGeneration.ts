import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { v4 as uuidv4 } from 'uuid';
import { Exam, ExamStatus } from '../types.js';
import { config } from '../config.js';
import { NotFoundError } from '../errors.js';
import { getCertificationById } from '../repositories/certifications.js';
import { createExam as createExamRecord } from '../repositories/exams.js';
import { createExam } from './exam.js';

export const sqsClient = new SQSClient({});

export interface CreatedExamResponse {
  id: string;
  certificationId: string;
  status: ExamStatus;
  title: string;
  createdAt: string;
}

export function toCreatedExamResponse(exam: Exam): CreatedExamResponse {
  return {
    id: exam.id,
    certificationId: exam.certificationId,
    status: exam.status,
    title: exam.title,
    createdAt: exam.createdAt,
  };
}

export async function requestExamGeneration(
  certificationId: string,
  now = new Date(),
): Promise<Exam> {
  const certification = await getCertificationById(certificationId);
  if (!certification || !certification.isActive) {
    throw new NotFoundError('Certification');
  }

  const exam = createExam(certification, now);
  await createExamRecord(exam);

  const correlationId = uuidv4();
  await sqsClient.send(
    new SendMessageCommand({
      QueueUrl: config.generatorQueueUrl,
      MessageBody: JSON.stringify({
        examId: exam.id,
        certificationId,
        correlationId,
      }),
    }),
  );

  return exam;
}
