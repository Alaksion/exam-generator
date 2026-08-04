import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { Certification, Exam, Difficulty, DifficultyDistribution, KnowledgeDomain } from '../types.js';
import { config } from '../config.js';

export interface PromptContext {
  questionNumber: number;
  difficulty: Difficulty;
  domain: string;
  certificationName: string;
  code: string;
}

export interface QuestionAttributes {
  number: number;
  difficulty: Difficulty;
  domain: string;
  domainId: string;
  topic: string;
  topicId: string;
}

const bedrockClient = new BedrockRuntimeClient({});

export function renderPrompt(template: string, context: PromptContext): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = context[key as keyof PromptContext];
    return value !== undefined ? String(value) : _match;
  });
}

export function allocateByWeight(
  questionCount: number,
  domains: KnowledgeDomain[],
): number[] {
  const exact = domains.map((domain) => (domain.weight / 100) * questionCount);
  const counts = exact.map(Math.floor);
  const remaining = questionCount - counts.reduce((a, b) => a + b, 0);

  const order = domains
    .map((_, index) => index)
    .sort(
      (a, b) => exact[b] - Math.floor(exact[b]) - (exact[a] - Math.floor(exact[a])),
    );

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
    domain: context.domain,
    certificationName: certification.name,
    code: certification.code,
  };
}

export async function regenerateQuestion(
  context: QuestionAttributes,
  certification: Certification,
  correlationId: string,
): Promise<string> {
  return generateQuestionRaw(
    config.bedrockModelDefault,
    certification.config.promptTemplate,
    buildPromptContext(context, certification),
    correlationId,
  );
}

export async function generateQuestionRaw(
  modelId: string,
  template: string,
  context: PromptContext,
  correlationId: string,
): Promise<string> {
  const prompt = renderPrompt(template, context);

  console.info('Rendering prompt for Bedrock', {
    correlationId,
    modelId,
    questionNumber: context.questionNumber,
    difficulty: context.difficulty,
    domain: context.domain,
    prompt,
  });

  const response = await bedrockClient.send(
    new InvokeModelCommand({
      modelId,
      body: Buffer.from(
        JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 1024,
          messages: [{ role: 'user', content: prompt }],
        }),
      ),
      contentType: 'application/json',
      accept: 'application/json',
    }),
  );

  const responseBody = JSON.parse(Buffer.from(response.body).toString()) as {
    content: Array<{ type?: string; text?: string }>;
  };
  return responseBody.content[0].text ?? '';
}

export async function generateExamQuestions(
  exam: Exam,
  certification: Certification,
  correlationId: string,
): Promise<string[]> {
  const attributes = buildQuestionContexts(certification.config);
  const rawResponses: string[] = [];

  for (const attribute of attributes) {
    const raw = await generateQuestionRaw(
      config.bedrockModelDefault,
      certification.config.promptTemplate,
      {
        questionNumber: attribute.number,
        difficulty: attribute.difficulty,
        domain: attribute.domain,
        certificationName: certification.name,
        code: certification.code,
      },
      correlationId,
    );
    rawResponses.push(raw);
  }

  console.info('Completed Bedrock generation', {
    correlationId,
    examId: exam.id,
    questionCount: rawResponses.length,
  });

  return rawResponses;
}
