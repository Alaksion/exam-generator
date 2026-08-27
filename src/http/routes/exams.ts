import { APIGatewayProxyEvent } from 'aws-lambda';
import { Router } from '../router.js';
import { jsonResponse, parseBody } from '../responses.js';
import { requireSub, toListResponse } from './helpers.js';
import {
  toExamDownloadDto,
  toExamStatusDto,
  toFullExamDto,
  toExamListQuery,
} from '../mappers.js';
import { toCreatedExamResponse, requestExamGeneration } from '../../services/examGenerationService.js';
import {
  deleteExam,
  getDownload,
  getFullExam,
  getOwnedExamOrThrow,
  listExams,
} from '../../services/examService.js';
import type { Exam, ExamStatusView } from '../../services/model.js';
import { ExamListQuery, RequestExamGeneration } from '../model.js';

export function registerExamRoutes(router: Router): void {
  router.register('POST', '/v1/exams', async (event) => {
    const sub = requireSub(event);
    const body = RequestExamGeneration.parse(parseBody(event));
    const exam = await requestExamGeneration(body.certificationId, sub);
    return jsonResponse(201, toCreatedExamResponse(exam));
  });

  router.register('GET', '/v1/exams', async (event) => {
    const sub = requireSub(event);
    const query = parseExamQuery(event);
    const { items, nextCursor } = await listExams({ ...query, ownerId: sub });
    return toListResponse(items, nextCursor);
  });

  router.register('GET', '/v1/exams/{id}', async (event, params) => {
    const sub = requireSub(event);
    const exam = await getOwnedExamOrThrow(params.id, sub);
    const fullExam = await getFullExam(exam);
    return jsonResponse(200, toFullExamDto(fullExam));
  });

  router.register('GET', '/v1/exams/{id}/status', async (event, params) => {
    const sub = requireSub(event);
    const exam = await getOwnedExamOrThrow(params.id, sub);
    return jsonResponse(200, toExamStatusDto(toStatusView(exam)));
  });

  router.register('GET', '/v1/exams/{id}/download', async (event, params) => {
    const sub = requireSub(event);
    const exam = await getOwnedExamOrThrow(params.id, sub);
    const download = await getDownload(exam);
    return jsonResponse(200, toExamDownloadDto(download));
  });

  router.register('DELETE', '/v1/exams/{id}', async (event, params) => {
    const sub = requireSub(event);
    const exam = await getOwnedExamOrThrow(params.id, sub);
    await deleteExam(exam);
    return { statusCode: 204, body: '' };
  });
}

function parseExamQuery(event: APIGatewayProxyEvent): ReturnType<typeof toExamListQuery> {
  const query = ExamListQuery.parse(
    Object.fromEntries(
      new URLSearchParams(
        (event.queryStringParameters as Record<string, string> | undefined) ?? {},
      ),
    ),
  );
  return toExamListQuery(query);
}

function toStatusView(exam: Exam): ExamStatusView {
  return {
    id: exam.id,
    status: exam.status,
    createdAt: exam.createdAt,
    finishedAt: exam.finishedAt,
  };
}