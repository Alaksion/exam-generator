import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  renderPrompt,
  buildQuestionPrompt,
  buildQuestionContexts,
  buildPromptContext,
  regenerateQuestion,
  generateQuestionRaw,
  generateExamQuestions,
  allocateByWeight,
  allocateByDifficulty,
  invokeWithRetry,
  isTransientError,
  mapWithConcurrency,
  QUESTION_PROMPT_TEMPLATE,
  PromptContext,
  QuestionAttributes,
} from './bedrock.js';
import { certification } from '../../test/fixtures/certification.js';
import { config } from '../config.js';
import { buildQuestionFormatSpec } from './questionParser.js';
import { Difficulty, KnowledgeDomain } from '../types.js';

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

vi.mock('../config.js', () => ({
  config: {
    bedrockModelDefault: 'amazon.nova-lite-v1:0',
    bedrockMaxAttempts: 3,
    bedrockConcurrency: 5,
  },
}));

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

const baseContext: PromptContext = {
  questionNumber: 3,
  difficulty: 'hard',
  knowledgeDomain: 'Billing',
  topic: 'Pricing',
  certificationName: 'AWS Certified Cloud Practitioner',
  certificationCode: 'CLF-C02',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('isTransientError', () => {
  it('returns true for throttling, service-unavailable, and internal errors', () => {
    expect(isTransientError(Object.assign(new Error('x'), { name: 'ThrottlingException' }))).toBe(
      true,
    );
    expect(
      isTransientError(Object.assign(new Error('x'), { name: 'ServiceUnavailableException' })),
    ).toBe(true);
    expect(
      isTransientError(Object.assign(new Error('x'), { name: 'InternalServerException' })),
    ).toBe(true);
    expect(isTransientError(Object.assign(new Error('x'), { name: 'ServiceUnavailable' }))).toBe(
      false,
    );
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

describe('renderPrompt', () => {
  it('replaces brace-style variables', () => {
    const template =
      'Generate a {difficulty} question about {knowledgeDomain} ({topic}) for {certificationName} ({certificationCode}) #{questionNumber}.';

    expect(renderPrompt(template, baseContext)).toBe(
      'Generate a hard question about Billing (Pricing) for AWS Certified Cloud Practitioner (CLF-C02) #3.',
    );
  });

  it('leaves unknown variables unchanged', () => {
    const template = 'Unknown {unknownVariable} and {difficulty}';

    expect(renderPrompt(template, baseContext)).toBe('Unknown {unknownVariable} and hard');
  });
});

describe('QUESTION_PROMPT_TEMPLATE / buildQuestionPrompt', () => {
  it('embeds a single centralized prompt constant', () => {
    expect(typeof QUESTION_PROMPT_TEMPLATE).toBe('string');
    expect(QUESTION_PROMPT_TEMPLATE.length).toBeGreaterThan(0);
  });

  it('renders the centralized prompt with all context keys and the derived JSON format', () => {
    const prompt = buildQuestionPrompt(baseContext);

    expect(prompt).toContain('AWS Certified Cloud Practitioner');
    expect(prompt).toContain('CLF-C02');
    expect(prompt).toContain('Billing');
    expect(prompt).toContain('Pricing');
    expect(prompt).toContain('hard');
    expect(prompt).toContain('question number 3');
    expect(prompt).toContain('strict JSON');
    expect(prompt).toContain(buildQuestionFormatSpec());
    expect(prompt).not.toContain('{certificationName}');
  });
});

describe('allocateByWeight', () => {
  it('distributes a value across weights summing exactly to the total', () => {
    const domains: KnowledgeDomain[] = [
      { id: 'a', name: 'A', weight: 50, topics: [] },
      { id: 'b', name: 'B', weight: 30, topics: [] },
      { id: 'c', name: 'C', weight: 20, topics: [] },
    ] as KnowledgeDomain[];

    const counts = allocateByWeight(10, domains);

    expect(counts).toEqual([5, 3, 2]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(10);
  });

  it('awards the leftover to the domain with the largest fractional remainder', () => {
    const domains: KnowledgeDomain[] = [
      { id: 'a', name: 'A', weight: 50, topics: [] },
      { id: 'b', name: 'B', weight: 30, topics: [] },
      { id: 'c', name: 'C', weight: 20, topics: [] },
    ] as KnowledgeDomain[];

    const counts = allocateByWeight(2, domains);

    expect(counts.reduce((a, b) => a + b, 0)).toBe(2);
    expect(counts).toEqual([1, 1, 0]);
  });
});

describe('allocateByDifficulty', () => {
  it('apportions a count across difficulties summing exactly to the count', () => {
    const counts = allocateByDifficulty(10, { easy: 20, medium: 50, hard: 30 });

    expect(counts.easy + counts.medium + counts.hard).toBe(10);
    expect(counts.easy).toBe(2);
    expect(counts.medium).toBe(5);
    expect(counts.hard).toBe(3);
  });
});

describe('buildQuestionContexts', () => {
  it('returns one context per question with sequential numbering', () => {
    const attributes = buildQuestionContexts(certification.config);

    expect(attributes).toHaveLength(certification.config.questionCount);
    attributes.forEach((attr, index) => {
      expect(attr.number).toBe(index + 1);
    });
  });

  it('allocates questions across domains by weight', () => {
    const attributes = buildQuestionContexts(certification.config);
    const byDomain = attributes.reduce<Record<string, number>>((acc, attr) => {
      acc[attr.domain] = (acc[attr.domain] ?? 0) + 1;
      return acc;
    }, {});

    expect(byDomain['Cloud Concepts']).toBe(5);
    expect(byDomain['Security']).toBe(3);
    expect(byDomain['Billing']).toBe(2);
  });

  it('apportions difficulty across all questions', () => {
    const attributes = buildQuestionContexts(certification.config);
    const byDifficulty = attributes.reduce<Record<Difficulty, number>>(
      (acc, attr) => {
        acc[attr.difficulty] += 1;
        return acc;
      },
      { easy: 0, medium: 0, hard: 0 },
    );

    expect(byDifficulty.easy + byDifficulty.medium + byDifficulty.hard).toBe(
      certification.config.questionCount,
    );
    expect(byDifficulty.easy).toBe(2);
    expect(byDifficulty.medium).toBe(5);
    expect(byDifficulty.hard).toBe(3);
  });

  it('assigns domain and topic provenance scoped to each domain', () => {
    const attributes = buildQuestionContexts(certification.config);
    const domainById = new Map(certification.config.domains.map((d) => [d.id, d]));

    for (const attr of attributes) {
      const domain = domainById.get(attr.domainId);
      expect(domain).toBeDefined();
      expect(attr.domain).toBe(domain!.name);
      expect(domain!.topics.some((t) => t.name === attr.topic && t.id === attr.topicId)).toBe(true);
    }
  });

  it('selects topics without replacement per domain, cycling when count exceeds topics', () => {
    const attributes = buildQuestionContexts(certification.config);
    const cloud = attributes.filter((attr) => attr.domain === 'Cloud Concepts');

    expect(cloud).toHaveLength(5);
    expect(cloud[0].topicId).not.toBe(cloud[1].topicId);
    expect(cloud[2].topicId).toBe(cloud[0].topicId);
    expect(cloud[3].topicId).toBe(cloud[1].topicId);
    expect(cloud[4].topicId).toBe(cloud[0].topicId);
  });

  it('gives a low-weight domain zero questions when sparsely allocated', () => {
    const attributes = buildQuestionContexts({
      ...certification.config,
      questionCount: 2,
    });

    const byDomain = attributes.reduce<Record<string, number>>((acc, attr) => {
      acc[attr.domain] = (acc[attr.domain] ?? 0) + 1;
      return acc;
    }, {});

    expect(attributes).toHaveLength(2);
    expect(byDomain['Billing'] ?? 0).toBe(0);
    expect(byDomain['Cloud Concepts'] ?? 0).toBe(1);
    expect(byDomain['Security'] ?? 0).toBe(1);
  });
});

describe('buildPromptContext', () => {
  it('combines question attributes with certification metadata including topic', () => {
    const attributes: QuestionAttributes = {
      number: 1,
      difficulty: 'medium',
      domain: 'Cloud Concepts',
      domainId: '22222222-2222-2222-2222-222222222222',
      topic: 'Amazon S3',
      topicId: '33333333-3333-3333-3333-333333333333',
    };

    const context = buildPromptContext(attributes, certification);

    expect(context).toEqual({
      questionNumber: 1,
      difficulty: 'medium',
      knowledgeDomain: 'Cloud Concepts',
      topic: 'Amazon S3',
      certificationName: certification.name,
      certificationCode: certification.code,
    });
  });
});

describe('regenerateQuestion', () => {
  it('uses the centralized prompt and the default model', async () => {
    sendMock.mockResolvedValue(makeBedrockResponse('retried question'));

    const attributes: QuestionAttributes = {
      number: 2,
      difficulty: 'easy',
      domain: 'Security',
      domainId: '55555555-5555-5555-5555-555555555555',
      topic: 'IAM',
      topicId: '66666666-6666-6666-6666-666666666666',
    };

    const raw = await regenerateQuestion(attributes, certification, 'corr-retry');

    expect(raw).toBe('retried question');
    expect(sendMock).toHaveBeenCalledTimes(1);

    const calls = sendMock.mock.calls as Array<[unknown]>;
    const commandInput = calls[0][0] as { modelId: string; body: Buffer };
    expect(commandInput.modelId).toBe(config.bedrockModelDefault);

    const requestBody = JSON.parse(commandInput.body.toString()) as {
      messages: Array<{ role: string; content: Array<{ text: string }> }>;
      inferenceConfig: { maxTokens: number };
    };
    expect(requestBody.messages[0].content[0].text).toContain('knowledge domain Security');
    expect(requestBody.messages[0].content[0].text).toContain('topic IAM');
    expect(requestBody.inferenceConfig.maxTokens).toBe(4999);
  });
});

describe('generateQuestionRaw', () => {
  it('renders the centralized prompt and returns the raw response text', async () => {
    sendMock.mockResolvedValue(makeBedrockResponse('raw question text'));

    const raw = await generateQuestionRaw(config.bedrockModelDefault, baseContext, 'corr-123');

    expect(raw).toBe('raw question text');
    expect(sendMock).toHaveBeenCalledTimes(1);

    const calls = sendMock.mock.calls as Array<[unknown]>;
    const commandInput = calls[0][0] as { modelId: string; body: Buffer };
    expect(commandInput.modelId).toBe(config.bedrockModelDefault);

    const requestBody = JSON.parse(commandInput.body.toString()) as {
      messages: Array<{ role: string; content: Array<{ text: string }> }>;
    };
    expect(requestBody.messages[0].content[0].text).toContain('Billing');
    expect(requestBody.messages[0].content[0].text).toContain('Pricing');
    expect(requestBody.messages[0].content[0].text).toContain(buildQuestionFormatSpec());
  });

  it('retries a throttled call through the backoff and returns the recovered text', async () => {
    vi.useFakeTimers();
    sendMock
      .mockRejectedValueOnce(Object.assign(new Error('throttled'), { name: 'ThrottlingException' }))
      .mockResolvedValueOnce(makeBedrockResponse('recovered'));

    const promise = generateQuestionRaw(config.bedrockModelDefault, baseContext, 'corr-retry');
    await vi.advanceTimersByTimeAsync(100_000);
    await expect(promise).resolves.toBe('recovered');

    expect(sendMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

describe('generateExamQuestions', () => {
  const questionCount = certification.config.questionCount;
  const exam = {
    id: '22222222-2222-2222-2222-222222222222',
    certificationId: certification.id,
    provider: 'aws' as const,
    title: 'AWS Certified Cloud Practitioner - Practice Exam 2026-07-28T12:00:00.000Z',
    status: 'GENERATING' as const,
    createdAt: '2026-07-28T12:00:00.000Z',
    finishedAt: null,
    s3KeyJson: undefined,
    s3KeyPdf: undefined,
  };

  it('calls Bedrock once per question and returns raw responses', async () => {
    sendMock.mockResolvedValue(makeBedrockResponse('raw response'));

    const rawResponses = await generateExamQuestions(exam, certification, 'corr-789');

    expect(rawResponses).toHaveLength(questionCount);
    expect(rawResponses.every((r) => r === 'raw response')).toBe(true);
    expect(sendMock).toHaveBeenCalledTimes(questionCount);
  });

  it('keeps responses aligned to question order when calls complete out of order', async () => {
    sendMock.mockImplementation(async (command: { body: Buffer }) => {
      const parsed = JSON.parse(command.body.toString()) as {
        messages: Array<{ role: string; content: Array<{ text: string }> }>;
      };
      const match = parsed.messages[0].content[0].text.match(/question number (\d+)/);
      const number = match ? Number(match[1]) : 0;
      await new Promise((resolve) => setTimeout(resolve, (12 - number) * 10));
      return makeBedrockResponse(`q${number}`);
    });

    const rawResponses = await generateExamQuestions(exam, certification, 'corr-order');

    expect(rawResponses).toEqual(Array.from({ length: questionCount }, (_, i) => `q${i + 1}`));
  });
});
