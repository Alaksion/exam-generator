import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { config } from '../../shared/config.js';

const bedrockClient = new BedrockRuntimeClient({ maxAttempts: 1 });

const TRANSIENT_ERROR_NAMES = new Set([
  'ThrottlingException',
  'ServiceUnavailableException',
  'InternalServerException',
]);

const MAX_BACKOFF_MS = 30_000;

export function isTransientError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return (
    TRANSIENT_ERROR_NAMES.has(error.name) || (error as { $retryable?: boolean }).$retryable === true
  );
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const poolLimit = limit < 1 ? 1 : limit;
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  let stopped = false;

  function takeNextIndex(): number | null {
    if (stopped) {
      return null;
    }
    const index = nextIndex;
    nextIndex += 1;
    return index < items.length ? index : null;
  }

  async function worker(): Promise<void> {
    let index = takeNextIndex();
    while (index !== null) {
      try {
        results[index] = await mapper(items[index], index);
      } catch (error) {
        stopped = true;
        throw error;
      }
      index = takeNextIndex();
    }
  }

  const workerCount = Math.min(poolLimit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

export async function invokeWithRetry<T>(
  operation: () => Promise<T>,
  attempts: number,
  sleep: (ms: number) => Promise<void> = delay,
): Promise<T> {
  const budget = attempts < 1 ? 1 : attempts;

  for (let attempt = 0; attempt < budget; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= budget - 1 || !isTransientError(error)) {
        throw error;
      }
      const backoffMs = 500 * 2 ** attempt;
      const jitterMs = Math.floor(Math.random() * 1000);
      await sleep(Math.min(backoffMs + jitterMs, MAX_BACKOFF_MS));
    }
  }

  throw new Error('invokeWithRetry: attempt budget exhausted');
}

export interface BedrockInvokeInput {
  modelId: string;
  text: string;
}

export async function invokeModel({ modelId, text }: BedrockInvokeInput): Promise<string> {
  const response = await invokeWithRetry(
    () =>
      bedrockClient.send(
        new InvokeModelCommand({
          modelId,
          body: Buffer.from(
            JSON.stringify({
              messages: [
                {
                  role: 'user',
                  content: [{ text }],
                },
              ],
              inferenceConfig: {
                maxTokens: 4999,
              },
            }),
          ),
          contentType: 'application/json',
          accept: 'application/json',
        }),
      ),
    config.bedrockMaxAttempts,
  );

  const responseBody = JSON.parse(Buffer.from(response.body).toString()) as {
    output?: { message?: { content?: Array<{ text?: string }> } };
  };
  return responseBody.output?.message?.content?.[0]?.text ?? '';
}