import {
  ConflictError,
  ExamNotFoundError,
  ExamNotReadyError,
  ForbiddenError,
  InvalidRequestError,
  NotFoundError,
  UnauthorizedError,
  isDomainError,
} from '../services/errors.js';

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  toResponse() {
    return {
      error: this.code,
      message: this.message,
    };
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function mapToApiError(error: unknown): ApiError {
  if (isApiError(error)) {
    return error;
  }

  if (isDomainError(error)) {
    const { statusCode, code } = mapDomain(error);
    return new ApiError(statusCode, code, error.message);
  }

  return new ApiError(500, 'InternalError', 'An internal error occurred.');
}

function mapDomain(error: { name: string }): { statusCode: number; code: string } {
  if (error instanceof NotFoundError) return { statusCode: 404, code: 'NotFound' };
  if (error instanceof ExamNotFoundError) return { statusCode: 404, code: 'ExamNotFound' };
  if (error instanceof ExamNotReadyError) return { statusCode: 409, code: 'ExamNotReady' };
  if (error instanceof ConflictError) return { statusCode: 409, code: 'Conflict' };
  if (error instanceof InvalidRequestError) return { statusCode: 400, code: 'InvalidRequest' };
  if (error instanceof UnauthorizedError) return { statusCode: 401, code: 'Unauthorized' };
  if (error instanceof ForbiddenError) return { statusCode: 403, code: 'Forbidden' };
  return { statusCode: 500, code: 'InternalError' };
}