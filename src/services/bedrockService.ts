import { config } from '../shared/config.js';
import { invokeModel, mapWithConcurrency } from '../data/datasources/bedrock.js';
import { buildQuestionFormatSpec } from './questionParserService.js';
import { planConcepts, zipConcepts } from './conceptPlannerService.js';
import {
  type Certification,
  type Difficulty,
  type DifficultyDistribution,
  type Exam,
  type KnowledgeDomain,
  type QuestionAttributes,
  type TopicContext,
} from './model.js';
import { type ConceptPlan } from './model.js';

export interface PromptContext {
  questionNumber: number;
  difficulty: Difficulty;
  knowledgeDomain: string;
  topic: string;
  topicContext: TopicContext;
  concept?: string;
  certificationName: string;
  certificationCode: string;
}

export const QUESTION_PROMPT_TEMPLATE =
  'You are preparing a practice question for the {certificationName} ({certificationCode}) certification. ' +
  'Limit the scope of the question to the level of knowledge expected of a candidate sitting this certification. ' +
  'Generate a single question scoped to the knowledge domain {knowledgeDomain} and topic {topic}. ' +
  'The question must stay strictly within the scope described by this topic context: {topicContext}. ' +
  '{conceptSentence}' +
  'The difficulty of the question must be {difficulty}. This is question number {questionNumber}. ' +
  'Return ONLY a strict JSON object in the exact format specified below.';

export const CONCEPT_PROMPT_SENTENCE =
  'The question must focus on exactly this concept, distinct from all other questions in the exam: {concept}. ';

export function buildQuestionPrompt(context: PromptContext): string {
  const conceptSentence = context.concept
    ? renderPrompt(CONCEPT_PROMPT_SENTENCE, context)
    : '';
  const rendered = renderPrompt(QUESTION_PROMPT_TEMPLATE, context).replace(
    '{conceptSentence}',
    conceptSentence,
  );
  return `${rendered}

Format:
${buildQuestionFormatSpec()}`;
}

export function renderTemplate(template: string, values: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = values[key];
    return value !== undefined ? String(value) : _match;
  });
}

export function renderPrompt(template: string, context: PromptContext): string {
  return renderTemplate(template, context as unknown as Record<string, unknown>);
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
    concept: context.concept,
    certificationName: certification.name,
    certificationCode: certification.code,
  };
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
    concept: context.concept,
    prompt,
  });

  return invokeModel({ modelId, text: prompt });
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
      });
      return generateQuestionRaw(
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

export interface V2GenerationResult {
  rawResponses: string[];
  contexts: QuestionAttributes[];
  plan: ConceptPlan;
}

export async function generateExamQuestionsV2(
  exam: Exam,
  certification: Certification,
  correlationId: string,
): Promise<V2GenerationResult> {
  const attributes = buildQuestionContexts(certification.config);
  const plan = await planConcepts(attributes, certification, correlationId);
  const contexts = zipConcepts(attributes, plan);

  const rawResponses = await mapWithConcurrency(
    contexts,
    config.bedrockConcurrency,
    async (attribute) => {
      console.info('Generating question', {
        correlationId,
        examId: exam.id,
        questionNumber: attribute.number,
        difficulty: attribute.difficulty,
        knowledgeDomain: attribute.domain,
        topic: attribute.topic,
        concept: attribute.concept,
      });
      return generateQuestionRaw(
        config.bedrockModelDefault,
        buildPromptContext(attribute, certification),
        correlationId,
      );
    },
  );

  console.info('Completed V2 Bedrock generation', {
    correlationId,
    examId: exam.id,
    questionCount: rawResponses.length,
  });

  return { rawResponses, contexts, plan };
}