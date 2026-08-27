import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { requestPasswordReset as requestPasswordResetData } from '../data/datasources/cognito.js';
import { requestPasswordReset } from './passwordResetService.js';

vi.mock('../data/datasources/cognito.js', () => ({
  requestPasswordReset: vi.fn(),
}));

const mockedReset = vi.mocked(requestPasswordResetData);

beforeEach(() => {
  vi.useFakeTimers();
  mockedReset.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

async function runWithTimers(email: string) {
  const promise = requestPasswordReset(email);
  await vi.runAllTimersAsync();
  return promise;
}

describe('requestPasswordReset', () => {
  it('delegates to the Cognito data source and returns ok', async () => {
    mockedReset.mockResolvedValue(undefined);

    const result = await runWithTimers('alice@example.com');

    expect(result).toEqual({ status: 'ok' });
    expect(mockedReset).toHaveBeenCalledWith('alice@example.com');
  });
});