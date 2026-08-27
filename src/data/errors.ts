export class DataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataError';
  }
}

export class InvalidCursorError extends DataError {
  constructor() {
    super('The cursor is malformed.');
    this.name = 'InvalidCursorError';
  }
}

export function isDataError(error: unknown): error is DataError {
  return error instanceof DataError;
}