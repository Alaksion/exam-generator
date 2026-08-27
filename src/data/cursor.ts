import { InvalidCursorError } from './errors.js';

export function encodeCursor(key: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(key)).toString('base64');
}

export function decodeCursor(cursor: string): Record<string, unknown> {
  try {
    return JSON.parse(Buffer.from(cursor, 'base64').toString()) as Record<string, unknown>;
  } catch {
    throw new InvalidCursorError();
  }
}