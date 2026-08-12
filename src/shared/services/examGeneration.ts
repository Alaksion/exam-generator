import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { Exam, ExamStatus, GeneratorMessage } from '../types.js';
import { config } from '../config.js';
import { NotFoundError } from '../errors.js';
import { getCertificationById } from '../repositories/certifications.js';
import { createExam as createExamRecord } from '../repositories/exams.js';
import { createExam } from './exam.js';

const sqsClient = new SQSClient({});

export const RequestExamGeneration = z.object({
  certificationId: z.string().uuid(),
});
export type RequestExamGeneration = z.infer<typeof RequestExamGeneration>;

export interface CreatedExamResponse {
  id: string;
  status: ExamStatus;
}

export function toCreatedExamResponse(exam: Exam): CreatedExamResponse {
  return {
    id: exam.id,
    status: exam.status,
  };
}

export async function sendGeneratorMessage(message: GeneratorMessage): Promise<void> {
  const validated = GeneratorMessage.parse(message);
  await sqsClient.send(
    new SendMessageCommand({
      QueueUrl: config.generatorQueueUrl,
      MessageBody: JSON.stringify(validated),
    }),
  );
}

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
