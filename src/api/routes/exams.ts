import { Router, jsonResponse, parseBody } from '../../shared/router.js';
import { getCurrentUser } from '../../shared/services/identity.js';
import {
  requestExamGeneration,
  toCreatedExamResponse,
  RequestExamGeneration,
} from '../../shared/services/examGeneration.js';
import { listExams } from '../../shared/repositories/exams.js';
import { toListResponse } from './helpers.js';
import {
  parseExamListQuery,
  loadOwnedExamOrThrow,
  toFullExamResponse,
  toStatusResponse,
  toDownloadResponse,
  deleteExamAndRespond,
} from './exam-helpers.js';

export function registerExamRoutes(router: Router): void {
  router.register('POST', '/v1/exams', async (event) => {
    const body = RequestExamGeneration.parse(parseBody(event));
    const user = await getCurrentUser(event);
    const exam = await requestExamGeneration(body.certificationId, user.userId);
    return jsonResponse(201, toCreatedExamResponse(exam));
  });

  router.register('GET', '/v1/exams', async (event) => {
    const user = await getCurrentUser(event);
    const query = parseExamListQuery(event);
    const { exams, nextCursor } = await listExams({ ...query, ownerId: user.userId });
    return toListResponse(exams, nextCursor);
  });

  router.register('GET', '/v1/exams/{id}', async (event, params) => {
    const user = await getCurrentUser(event);
    const exam = await loadOwnedExamOrThrow(params.id, user.userId);
    return toFullExamResponse(exam);
  });

  router.register('GET', '/v1/exams/{id}/status', async (event, params) => {
    const user = await getCurrentUser(event);
    const exam = await loadOwnedExamOrThrow(params.id, user.userId);
    return toStatusResponse(exam);
  });

  router.register('GET', '/v1/exams/{id}/download', async (event, params) => {
    const user = await getCurrentUser(event);
    const exam = await loadOwnedExamOrThrow(params.id, user.userId);
    return toDownloadResponse(exam);
  });

  router.register('DELETE', '/v1/exams/{id}', async (event, params) => {
    const user = await getCurrentUser(event);
    const exam = await loadOwnedExamOrThrow(params.id, user.userId);
    return deleteExamAndRespond(exam);
  });
}