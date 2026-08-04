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

    const result = await fetchExpectedKey();

    expect(result).toEqual({ ok: true, key: 'expected-secret' });
  });

  it('returns a missing-parameter error when the parameter name is not configured', async () => {
    delete process.env.API_KEY_PARAMETER_NAME;

    const result = await fetchExpectedKey();

    expect(result).toEqual({ ok: false, error: 'missing-parameter' });
  });

  it('returns an empty-parameter error when the parameter value is empty', async () => {
    vi.spyOn(ssmClient, 'send').mockResolvedValue({ Parameter: { Value: undefined } } as never);

    const result = await fetchExpectedKey();

    expect(result).toEqual({ ok: false, error: 'empty-parameter' });
  });

  it('returns an ssm-error when SSM throws', async () => {
    vi.spyOn(ssmClient, 'send').mockRejectedValue(new Error('boom'));

    const result = await fetchExpectedKey();

    expect(result).toEqual({ ok: false, error: 'ssm-error' });
  });
});
