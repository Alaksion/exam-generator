import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  invokeModel,
  invokeWithRetry,
  isTransientError,
  mapWithConcurrency,
} from './bedrock.js';

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

vi.mock('@aws-sdk/client-bedrock-runtime', () => {
  class MockBedrockRuntimeClient {
    send = sendMock;
  }
  class MockInvokeModelCommand {
    constructor(input: unknown) {
      Object.assign(this, input);
    }
  }
  return {
    BedrockRuntimeClient: MockBedrockRuntimeClient,
    InvokeModelCommand: MockInvokeModelCommand,
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('isTransientError', () => {
  it('returns true for throttling, service-unavailable, and internal errors', () => {
    expect(isTransientError(Object.assign(new Error('x'), { name: 'ThrottlingException' }))).toBe(true);
    expect(
      isTransientError(Object.assign(new Error('x'), { name: 'ServiceUnavailableException' })),
    ).toBe(true);
    expect(
      isTransientError(Object.assign(new Error('x'), { name: 'InternalServerException' })),
    ).toBe(true);
    expect(isTransientError(Object.assign(new Error('x'), { name: 'ServiceUnavailable' }))).toBe(false);
  });

  it('returns true when the SDK marks the error as retryable', () => {
    expect(isTransientError(Object.assign(new Error('x'), { $retryable: true }))).toBe(true);
  });

  it('returns false for permanent errors and non-errors', () => {
    expect(isTransientError(new Error('boom'))).toBe(false);
    expect(isTransientError('boom')).toBe(false);
    expect(isTransientError(undefined)).toBe(false);
  });
});

describe('invokeWithRetry', () => {
  const noopSleep = async (): Promise<void> => {};

  it('returns the operation result on the first attempt', async () => {
    const operation = vi.fn().mockResolvedValue('ok');
    await expect(invokeWithRetry(operation, 3, noopSleep)).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('retries a transient failure with backoff and returns on success', async () => {
    const sleeps: number[] = [];
    const operation = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('throttled'), { name: 'ThrottlingException' }))
      .mockResolvedValueOnce('ok');

    const result = await invokeWithRetry(operation, 3, async (ms) => {
      sleeps.push(ms);
    });

    expect(result).toBe('ok');
    expect(operation).toHaveBeenCalledTimes(2);
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBeGreaterThanOrEqual(0);
  });

  it('fails immediately on a non-transient error', async () => {
    const operation = vi.fn().mockRejectedValue(new Error('permanent'));
    await expect(invokeWithRetry(operation, 3, noopSleep)).rejects.toThrow('permanent');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('exhausts the attempt budget on persistent transient failures', async () => {
    const operation = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('throttled'), { name: 'ThrottlingException' }));
    await expect(invokeWithRetry(operation, 3, noopSleep)).rejects.toThrow('throttled');
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('treats an attempt budget below one as a single attempt', async () => {
    const operation = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('throttled'), { name: 'ThrottlingException' }));
    await expect(invokeWithRetry(operation, 0, noopSleep)).rejects.toThrow('throttled');
    expect(operation).toHaveBeenCalledTimes(1);
  });
});

describe('mapWithConcurrency', () => {
  it('preserves input order even when work completes out of order', async () => {
    const input = [1, 2, 3, 4];
    const results = await mapWithConcurrency(input, 2, async (value) => {
      await new Promise((resolve) => setTimeout(resolve, (4 - value) * 10));
      return value * 10;
    });
    expect(results).toEqual([10, 20, 30, 40]);
  });

  it('never exceeds the concurrency limit', async () => {
    const input = [1, 2, 3, 4, 5, 6];
    let inFlight = 0;
    let maxInFlight = 0;

    await mapWithConcurrency(input, 2, async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
    });

    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  it('returns an empty array for empty input', async () => {
    await expect(mapWithConcurrency([], 3, async (v) => v)).resolves.toEqual([]);
  });

  it('treats a limit below one as a limit of one', async () => {
    const results = await mapWithConcurrency([1, 2], 0, async (v) => v * 2);
    expect(results).toEqual([2, 4]);
  });

  it('stops dispatching further items once a mapper rejects', async () => {
    const started: number[] = [];
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (value) => {
        started.push(value);
        if (value === 2) {
          throw new Error('boom');
        }
        await new Promise((resolve) => setTimeout(resolve, 30));
        return value;
      }),
    ).rejects.toThrow('boom');

    expect(started).toEqual([1, 2]);
  });
});

describe('invokeModel', () => {
  function makeBedrockResponse(text: string): { body: Uint8Array } {
    return {
      body: Uint8Array.from(
        Buffer.from(
          JSON.stringify({
            output: {
              message: {
                role: 'assistant',
                content: [{ text }],
              },
            },
          }),
        ),
      ),
    };
  }

  it('sends the model payload and returns the response text', async () => {
    sendMock.mockResolvedValue(makeBedrockResponse('raw question text'));

    const raw = await invokeModel({ modelId: 'amazon.nova-lite-v1:0', text: 'a prompt' });

    expect(raw).toBe('raw question text');
    expect(sendMock).toHaveBeenCalledTimes(1);
    const calls = sendMock.mock.calls as Array<[unknown]>;
    const commandInput = calls[0][0] as { modelId: string; body: Buffer };
    expect(commandInput.modelId).toBe('amazon.nova-lite-v1:0');
    const requestBody = JSON.parse(commandInput.body.toString()) as {
      messages: Array<{ role: string; content: Array<{ text: string }> }>;
      inferenceConfig: { maxTokens: number };
    };
    expect(requestBody.messages[0].content[0].text).toBe('a prompt');
    expect(requestBody.inferenceConfig.maxTokens).toBe(4999);
  });

  it('retries a throttled call through the backoff and returns the recovered text', async () => {
    vi.useFakeTimers();
    sendMock
      .mockRejectedValueOnce(Object.assign(new Error('throttled'), { name: 'ThrottlingException' }))
      .mockResolvedValueOnce(makeBedrockResponse('recovered'));

    const promise = invokeModel({ modelId: 'amazon.nova-lite-v1:0', text: 'a prompt' });
    await vi.advanceTimersByTimeAsync(100_000);
    await expect(promise).resolves.toBe('recovered');

    expect(sendMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});