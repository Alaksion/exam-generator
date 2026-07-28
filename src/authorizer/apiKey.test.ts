import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchExpectedKey, ssmClient } from './apiKey.js';

describe('fetchExpectedKey', () => {
  const originalParameterName = process.env.API_KEY_PARAMETER_NAME;

  beforeEach(() => {
    process.env.API_KEY_PARAMETER_NAME = '/test/api-key';
  });

  afterEach(() => {
    process.env.API_KEY_PARAMETER_NAME = originalParameterName;
    vi.restoreAllMocks();
  });

  it('returns the parameter value from SSM', async () => {
    vi.spyOn(ssmClient, 'send').mockResolvedValue({
      Parameter: { Value: 'expected-secret' },
    } as never);

    const key = await fetchExpectedKey();

    expect(key).toBe('expected-secret');
  });

  it('throws when the parameter name is not configured', async () => {
    delete process.env.API_KEY_PARAMETER_NAME;

    await expect(fetchExpectedKey()).rejects.toThrow('Missing API_KEY_PARAMETER_NAME');
  });

  it('throws when the parameter value is empty', async () => {
    vi.spyOn(ssmClient, 'send').mockResolvedValue({ Parameter: { Value: undefined } } as never);

    await expect(fetchExpectedKey()).rejects.toThrow('API key parameter is empty');
  });
});
