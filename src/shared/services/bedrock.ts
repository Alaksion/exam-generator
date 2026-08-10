import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import {
  Certification,
  Exam,
  Difficulty,
  DifficultyDistribution,
  KnowledgeDomain,
} from '../types.js';
import { config } from '../config.js';
import { buildQuestionFormatSpec } from './questionParser.js';

export interface PromptContext {
  questionNumber: number;
  difficulty: Difficulty;
  knowledgeDomain: string;
  topic: string;
  topicContext: string;
  certificationName: string;
  certificationCode: string;
}

export interface QuestionAttributes {
  number: number;
  difficulty: Difficulty;
  domain: string;
  domainId: string;
  topic: string;
  topicId: string;
  topicContext: string;
}

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

export const QUESTION_PROMPT_TEMPLATE =
  'You are preparing a practice question for the {certificationName} ({certificationCode}) certification. ' +
  'Limit the scope of the question to the level of knowledge expected of a candidate sitting this certification. ' +
  'Generate a single question scoped to the knowledge domain {knowledgeDomain} and topic {topic}. ' +
  'The question must stay strictly within the scope described by this topic context: {topicContext}. ' +
  'The difficulty of the question must be {difficulty}. This is question number {questionNumber}. ' +
  'Return ONLY a strict JSON object in the exact format specified below.';

export function buildQuestionPrompt(context: PromptContext): string {
  return `${renderPrompt(QUESTION_PROMPT_TEMPLATE, context)}

Format:
${buildQuestionFormatSpec()}`;
}

export function renderPrompt(template: string, context: PromptContext): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = context[key as keyof PromptContext];
    return value !== undefined ? String(value) : _match;
  });
}

export function allocateByWeight(questionCount: number, domains: KnowledgeDomain[]): number[] {
  const exact = domains.map((domain) => (domain.weight / 100) * questionCount);
  const counts = exact.map(Math.floor);
  const remaining = questionCount - counts.reduce((a, b) => a + b, 0);

  const order = domains
    .map((_, index) => index)
    .sort((a, b) => exact[b] - Math.floor(exact[b]) - (exact[a] - Math.floor(exact[a])));

  for (let i = 0; i < remaining && i < order.length; i++) {
    counts[order[i]] += 1;
  }

  return counts;
}

export function allocateByDifficulty(
  count: number,
  distribution: DifficultyDistribution,
): Record<Difficulty, number> {
  const exact: Record<Difficulty, number> = {
    easy: (distribution.easy / 100) * count,
    medium: (distribution.medium / 100) * count,
    hard: (distribution.hard / 100) * count,
  };
  const counts: Record<Difficulty, number> = {
    easy: Math.floor(exact.easy),
    medium: Math.floor(exact.medium),
    hard: Math.floor(exact.hard),
  };
  const remaining = count - (counts.easy + counts.medium + counts.hard);

  const order: Difficulty[] = (['easy', 'medium', 'hard'] as Difficulty[]).sort(
    (a, b) => exact[b] - Math.floor(exact[b]) - (exact[a] - Math.floor(exact[a])),
  );

  for (let i = 0; i < remaining && i < order.length; i++) {
    counts[order[i]] += 1;
  }

  return counts;
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function buildQuestionContexts(
  config: Certification['config'],
  random: () => number = Math.random,
): QuestionAttributes[] {
  const domainCounts = allocateByWeight(config.questionCount, config.domains);
  const attributes: QuestionAttributes[] = [];
  let number = 1;

  config.domains.forEach((domain, index) => {
    const count = domainCounts[index];
    if (count === 0) {
      return;
    }

    const difficultyCounts = allocateByDifficulty(count, config.difficultyDistribution);
    const difficulties: Difficulty[] = [
      ...Array.from({ length: difficultyCounts.easy }, () => 'easy' as Difficulty),
      ...Array.from({ length: difficultyCounts.medium }, () => 'medium' as Difficulty),
      ...Array.from({ length: difficultyCounts.hard }, () => 'hard' as Difficulty),
    ];
    const shuffledTopics = shuffle(domain.topics, random);

    for (let slot = 0; slot < count; slot++) {
      const topic = shuffledTopics[slot % shuffledTopics.length];
      attributes.push({
        number: number++,
        difficulty: difficulties[slot],
        domain: domain.name,
        domainId: domain.id,
        topic: topic.name,
        topicId: topic.id,
        topicContext: topic.context,
      });
    }
  });

  return attributes;
}

export function buildPromptContext(
  context: QuestionAttributes,
  certification: Certification,
): PromptContext {
  return {
    questionNumber: context.number,
    difficulty: context.difficulty,
    knowledgeDomain: context.domain,
    topic: context.topic,
    topicContext: context.topicContext,
    certificationName: certification.name,
    certificationCode: certification.code,
  };
}

export async function regenerateQuestion(
  context: QuestionAttributes,
  certification: Certification,
  correlationId: string,
): Promise<string> {
  return generateQuestionRaw(
    config.bedrockModelDefault,
    buildPromptContext(context, certification),
    correlationId,
  );
}

export async function generateQuestionRaw(
  modelId: string,
  context: PromptContext,
  correlationId: string,
): Promise<string> {
  const prompt = buildQuestionPrompt(context);

  console.info('Rendering prompt for Bedrock', {
    correlationId,
    modelId,
    questionNumber: context.questionNumber,
    difficulty: context.difficulty,
    knowledgeDomain: context.knowledgeDomain,
    topic: context.topic,
    topicContext: context.topicContext,
    prompt,
  });

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
                  content: [{ text: prompt }],
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

export async function generateExamQuestions(
  exam: Exam,
  certification: Certification,
  correlationId: string,
): Promise<string[]> {
  const attributes = buildQuestionContexts(certification.config);

  const rawResponses = await mapWithConcurrency(
    attributes,
    config.bedrockConcurrency,
    async (attribute) => {
      console.info('Generating question', {
        correlationId,
        examId: exam.id,
        questionNumber: attribute.number,
        difficulty: attribute.difficulty,
        knowledgeDomain: attribute.domain,
        topic: attribute.topic,
        topicContext: attribute.topicContext,
      });
      return await generateQuestionRaw(
        config.bedrockModelDefault,
        buildPromptContext(attribute, certification),
        correlationId,
      );
    },
  );

  console.info('Completed Bedrock generation', {
    correlationId,
    examId: exam.id,
    questionCount: rawResponses.length,
  });

  return rawResponses;
}
