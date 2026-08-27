export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainError';
  }
}

export class NotFoundError extends DomainError {
  constructor(resource = 'Resource') {
    super(`${resource} not found.`);
    this.name = 'NotFoundError';
  }
}

export class ExamNotFoundError extends DomainError {
  constructor() {
    super('Exam not found.');
    this.name = 'ExamNotFoundError';
  }
}

export class ExamNotReadyError extends DomainError {
  constructor() {
    super('The exam is not ready yet.');
    this.name = 'ExamNotReadyError';
  }
}

export class ConflictError extends DomainError {
  constructor(message = 'The request conflicts with the current state.') {
    super(message);
    this.name = 'ConflictError';
  }
}

export class InvalidRequestError extends DomainError {
  constructor(message = 'The request is invalid.') {
    super(message);
    this.name = 'InvalidRequestError';
  }
}

export class UnauthorizedError extends DomainError {
  constructor(message = 'Authentication is required.') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = 'You do not have permission to perform this action.') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}