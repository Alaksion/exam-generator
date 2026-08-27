import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { z } from 'zod';
import { jsonResponse } from '../../shared/router.js';
import { NotFoundError, ExamNotReadyError } from '../../shared/errors.js';
import { Exam, Provider, ExamStatus } from '../../shared/types.js';
import { getExamById, deleteExam } from '../../shared/repositories/exams.js';
import {
  getCanonicalExam,
  getPresignedDownloadUrl,
  deleteArtifacts,
} from '../../shared/repositories/artifacts.js';

export const ExamListQuery = z.object({
  status: ExamStatus.default('READY'),
  provider: Provider.optional(),
  certificationId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
});
export type ExamListQuery = z.infer<typeof ExamListQuery>;

export function parseExamListQuery(event: APIGatewayProxyEvent): ExamListQuery {
  return ExamListQuery.parse(
    Object.fromEntries(
      new URLSearchParams(
        (event.queryStringParameters as Record<string, string> | undefined) ?? {},
      ),
    ),
  );
}

export async function getExamOrThrow(id: string): Promise<Exam> {
  const exam = await getExamById(id);
  if (!exam) {
    throw new NotFoundError('Exam');
  }
  return exam;
}

export async function loadOwnedExamOrThrow(id: string, ownerId: string): Promise<Exam> {
  const exam = await getExamOrThrow(id);
  if (exam.ownerId !== ownerId) {
    throw new NotFoundError('Exam');
  }
  return exam;
}

export async function toFullExamResponse(exam: Exam): Promise<APIGatewayProxyResult> {
  if (exam.status !== 'READY' || !exam.s3KeyJson) {
    throw new ExamNotReadyError();
  }
  const fullExam = await getCanonicalExam(exam.s3KeyJson);
  return jsonResponse(200, fullExam);
}

export function toStatusResponse(exam: Exam): APIGatewayProxyResult {
  return jsonResponse(200, {
    id: exam.id,
    status: exam.status,
    createdAt: exam.createdAt,
    finishedAt: exam.finishedAt,
  });
}

export async function toDownloadResponse(exam: Exam): Promise<APIGatewayProxyResult> {
  if (exam.status !== 'READY' || !exam.s3KeyPdf) {
    throw new ExamNotReadyError();
  }
  const { url, expiresAt } = await getPresignedDownloadUrl(exam.s3KeyPdf);
  return jsonResponse(200, { downloadUrl: url, expiresAt });
}

export async function deleteExamAndRespond(exam: Exam): Promise<APIGatewayProxyResult> {
  const s3Keys = [exam.s3KeyJson, exam.s3KeyPdf].filter((key): key is string => Boolean(key));
  if (s3Keys.length > 0) {
    await deleteArtifacts(s3Keys);
  }
  await deleteExam(exam.id);
  return { statusCode: 204, body: '' };
}