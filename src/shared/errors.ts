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

export class InvalidRequestError extends ApiError {
  constructor(message = 'The request is invalid.') {
    super(400, 'InvalidRequest', message);
  }
}

export class NotFoundError extends ApiError {
  constructor(resource = 'Resource') {
    super(404, 'NotFound', `${resource} not found.`);
  }
}

export class ExamNotFoundError extends ApiError {
  constructor() {
    super(404, 'ExamNotFound', 'Exam not found.');
  }
}

export class ExamNotReadyError extends ApiError {
  constructor() {
    super(409, 'ExamNotReady', 'The exam is not ready yet.');
  }
}

export class ConflictError extends ApiError {
  constructor(message = 'The request conflicts with the current state.') {
    super(409, 'Conflict', message);
  }
}

export class InternalError extends ApiError {
  constructor(message = 'An internal error occurred.') {
    super(500, 'InternalError', message);
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}
