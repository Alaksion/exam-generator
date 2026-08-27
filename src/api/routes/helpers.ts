import { APIGatewayProxyResult } from 'aws-lambda';
import { jsonResponse } from '../../shared/router.js';

export function toListResponse<T>(items: T[], nextCursor?: string): APIGatewayProxyResult {
  return jsonResponse(200, {
    items,
    cursor: {
      nextCursor: nextCursor ?? null,
      hasNextPage: Boolean(nextCursor),
    },
  });
}