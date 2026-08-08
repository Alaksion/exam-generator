import { SQSEvent, SQSRecord } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { GeneratorMessage, FullExam, Exam } from '../shared/types.js';
import { config } from '../shared/config.js';
import { getExamById, updateExamStatus } from '../shared/repositories/exams.js';
import { getCertificationById } from '../shared/repositories/certifications.js';
import { transitionExamStatus } from '../shared/services/exam.js';
import { generateExamQuestions, buildQuestionContexts, regenerateQuestion } from '../shared/services/bedrock.js';
import { parseExamQuestions } from '../shared/services/questionParser.js';

import { renderExamPdf } from '../shared/services/pdfRenderer.js';

export const CANONICAL_EXAM_SCHEMA_VERSION = '2.0.0';

const s3Client = new S3Client({});

export function buildArtifactKeys(examId: string): { s3KeyJson: string; s3KeyPdf: string; s3KeyRaw: string } {
  return {
    s3KeyJson: `exams/${examId}/exam.json`,
    s3KeyPdf: `exams/${examId}/exam.pdf`,
    s3KeyRaw: `exams/${examId}/raw.json`,
  };
}

function putArtifact(key: string, body: string | Buffer, contentType: string): Promise<unknown> {
  return s3Client.send(
    new PutObjectCommand({
      Bucket: config.artifactsBucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export const handler = async (event: SQSEvent): Promise<void> => {
  for (const record of event.Records) {
    await processRecord(record);
  }
};

async function processRecord(record: SQSRecord): Promise<void> {
  const payload = JSON.parse(record.body) as unknown;
  const message = GeneratorMessage.parse(payload);

  const exam = await getExamById(message.examId);
  if (!exam) {
    console.warn('Exam not found, skipping record', { examId: message.examId });
    return;
  }

  if (exam.status !== 'PENDING') {
    console.info('Exam is not pending, aborting record to prevent duplicate generation', {
      examId: exam.id,
      status: exam.status,
    });
    return;
  }

  const claimed = await claimPendingExam(exam.id);
  if (!claimed) {
    console.info('Failed to claim exam for generation, another worker is already generating', {
      examId: exam.id,
    });
    return;
  }
  const generating = transitionExamStatus(exam, 'GENERATING');

  try {
    const certification = await getCertificationById(message.certificationId);
    if (!certification) {
      throw new Error('Certification not found');
    }

    const rawResponses = await generateExamQuestions(generating, certification, message.correlationId);
    const contexts = buildQuestionContexts(certification.config);
    const questions = await parseExamQuestions(rawResponses, contexts, async (context) =>
      regenerateQuestion(context, certification, message.correlationId),
    );
    if (!questions) {
      throw new Error('Question parsing failed after retry');
    }

    const { s3KeyJson, s3KeyPdf, s3KeyRaw } = buildArtifactKeys(exam.id);
    const now = new Date();
    const transitioned = transitionExamStatus(generating, 'READY', now);

    const fullExam: FullExam = {
      schemaVersion: CANONICAL_EXAM_SCHEMA_VERSION,
      ...transitioned,
      s3KeyJson,
      s3KeyPdf,
      questions,
    };

    await putArtifact(s3KeyRaw, JSON.stringify(rawResponses), 'application/json');
    await putArtifact(s3KeyJson, JSON.stringify(fullExam), 'application/json');

    const pdfBuffer = await renderExamPdf(fullExam);
    await putArtifact(s3KeyPdf, pdfBuffer, 'application/pdf');

    await updateExamStatus(exam.id, 'READY', {
      finishedAt: transitioned.finishedAt,
      s3KeyJson,
      s3KeyPdf,
    });
  } catch (error) {
    await failExam(exam.id, generating, message.correlationId, error);
  }
}

async function claimPendingExam(examId: string): Promise<boolean> {
  return updateExamStatus(examId, 'GENERATING', {}, 'PENDING');
}

async function failExam(
  examId: string,
  generating: Exam,
  correlationId: string,
  error: unknown,
): Promise<void> {
  const failed = transitionExamStatus(generating, 'FAILED', new Date());
  console.error('Exam generation failed', {
    examId,
    correlationId,
    error: error instanceof Error ? error.message : error,
  });
  await updateExamStatus(examId, 'FAILED', {
    finishedAt: failed.finishedAt,
  });
}
