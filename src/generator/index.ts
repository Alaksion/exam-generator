import { SQSEvent, SQSRecord } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { GeneratorMessage } from '../shared/types.js';
import { config } from '../shared/config.js';
import { getExamById, updateExamStatus } from '../shared/repositories/exams.js';
import { getCertificationById } from '../shared/repositories/certifications.js';
import { transitionExamStatus } from '../shared/services/exam.js';
import { generateExamQuestions } from '../shared/services/bedrock.js';

export const STUB_SCHEMA_VERSION = '1.0.0';
export const STUB_PDF_CONTENT = 'placeholder PDF content';

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

  if (exam.status !== 'GENERATING') {
    console.info('Exam already processed, skipping record', { examId: exam.id, status: exam.status });
    return;
  }

  const certification = await getCertificationById(message.certificationId);
  if (!certification) {
    console.warn('Certification not found, skipping record', {
      examId: exam.id,
      certificationId: message.certificationId,
    });
    return;
  }

  const rawResponses = await generateExamQuestions(exam, certification, message.correlationId);

  const { s3KeyJson, s3KeyPdf, s3KeyRaw } = buildArtifactKeys(exam.id);
  const now = new Date();
  const transitioned = transitionExamStatus(exam, 'READY', now);

  const fullExam = {
    schemaVersion: STUB_SCHEMA_VERSION,
    ...transitioned,
    s3KeyJson,
    s3KeyPdf,
    questions: [],
  };

  await putArtifact(s3KeyRaw, JSON.stringify(rawResponses), 'application/json');
  await putArtifact(s3KeyJson, JSON.stringify(fullExam), 'application/json');
  await putArtifact(s3KeyPdf, Buffer.from(STUB_PDF_CONTENT), 'application/pdf');

  await updateExamStatus(exam.id, 'READY', {
    finishedAt: transitioned.finishedAt,
    s3KeyJson,
    s3KeyPdf,
  });
}
