import { z } from 'zod';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { Certification, QuestionAttributes, TopicContext } from '../types.js';
import { config } from '../config.js';
import { mapWithConcurrency, isTransientError, renderTemplate } from './bedrock.js';

export const ConceptPlanSchema = z.array(
  z.object({
    number: z.number().int().positive(),
    concept: z.string().min(1),
  }),
);
export type ConceptPlan = z.infer<typeof ConceptPlanSchema>;

const bedrockClient = new BedrockRuntimeClient({ maxAttempts: 1 });

export const CONCEPT_PLAN_PROMPT_TEMPLATE =
  'You are planning distinct question concepts for the {certificationName} ({certificationCode}) certification. ' +
  'The questions below all belong to the topic {topic}. Each question must stay strictly within the scope described by this topic context: {topicContext}. ' +
  'Assign each question number exactly one concept: a narrow, distinct sub-facet of the topic context that no other question in this topic covers. ' +
  'Every concept must be drawn strictly inside the topic context and must not broaden or reinterpret it. ' +
  'Question numbers to cover: {numbers}. ' +
  'Return ONLY a strict JSON array in the exact format specified below, with exactly one entry per question number.';

export function buildConceptPlanFormatSpec(): string {
  const entryShape = ConceptPlanSchema.element.shape;
  const example = (number: number): Record<string, unknown> => {
    const row: Record<string, unknown> = {};
    for (const key of Object.keys(entryShape)) {
      if (key === 'number') {
        row[key] = number;
      } else if (key === 'concept') {
        row[key] = '<narrow, distinct sub-facet of the topic context>';
      }
    }
    return row;
  };
  return JSON.stringify([example(1), example(2)], null, 2);
}

export interface PlannerTopicGroup {
  topicId: string;
  topic: string;
  topicContext: TopicContext;
  questions: QuestionAttributes[];
}

export function groupSlotsByTopic(attributes: QuestionAttributes[]): PlannerTopicGroup[] {
  const groups = new Map<string, PlannerTopicGroup>();
  for (const attribute of attributes) {
    const existing = groups.get(attribute.topicId);
    if (existing) {
      existing.questions.push(attribute);
    } else {
      groups.set(attribute.topicId, {
        topicId: attribute.topicId,
        topic: attribute.topic,
        topicContext: attribute.topicContext,
        questions: [attribute],
      });
    }
  }
  return [...groups.values()];
}

export function buildConceptPlanPrompt(
  group: PlannerTopicGroup,
  certification: Certification,
): string {
  const numbers = group.questions.map((question) => question.number).join(', ');
  const rendered = renderTemplate(CONCEPT_PLAN_PROMPT_TEMPLATE, {
    certificationName: certification.name,
    certificationCode: certification.code,
    topic: group.topic,
    topicContext: group.topicContext,
    numbers,
  });

  return `${rendered}

Format:
${buildConceptPlanFormatSpec()}`;
}

export function parseConceptPlan(rawResponse: string): ConceptPlan | null {
  const arrayText = extractJsonArray(rawResponse);
  if (arrayText === null) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(arrayText);
  } catch {
    return null;
  }
  const validated = ConceptPlanSchema.safeParse(parsed);
  return validated.success ? validated.data : null;
}

function extractJsonArray(rawResponse: string): string | null {
  const codeBlockMatch = rawResponse.match(/```(?:json)?\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1];
  }

  const startIndex = rawResponse.indexOf('[');
  const endIndex = rawResponse.lastIndexOf(']');
  if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
    return rawResponse.slice(startIndex, endIndex + 1);
  }

  return null;
}

export function verifyPlanNumberSet(plan: ConceptPlan, expectedNumbers: number[]): boolean {
  const got = plan.map((entry) => entry.number).slice().sort((a, b) => a - b);
  const expected = expectedNumbers.slice().sort((a, b) => a - b);
  return got.length === expected.length && got.every((number, index) => number === expected[index]);
}

export function zipConcepts(
  attributes: QuestionAttributes[],
  plan: ConceptPlan,
): QuestionAttributes[] {
  const byNumber = new Map(plan.map((entry) => [entry.number, entry.concept]));
  return attributes.map((attribute) => ({ ...attribute, concept: byNumber.get(attribute.number) }));
}

async function invokePlannerOnce(
  group: PlannerTopicGroup,
  certification: Certification,
  correlationId: string,
): Promise<string> {
  const prompt = buildConceptPlanPrompt(group, certification);
  console.info('Invoking concept planner', { correlationId, prompt });

  const response = await bedrockClient.send(
    new InvokeModelCommand({
      modelId: config.bedrockModelDefault,
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
  );

  const responseBody = JSON.parse(Buffer.from(response.body).toString()) as {
    output?: { message?: { content?: Array<{ text?: string }> } };
  };
  return responseBody.output?.message?.content?.[0]?.text ?? '';
}

async function planTopicGroup(
  group: PlannerTopicGroup,
  certification: Certification,
  correlationId: string,
): Promise<ConceptPlan> {
  const expectedNumbers = group.questions.map((question) => question.number);
  let lastFailure: Error = new Error('Concept planner produced no output');

  for (let attempt = 0; attempt < config.bedrockMaxAttempts; attempt++) {
    try {
      const rawResponse = await invokePlannerOnce(group, certification, correlationId);
      const plan = parseConceptPlan(rawResponse);
      if (plan && verifyPlanNumberSet(plan, expectedNumbers)) {
        return plan;
      }
      lastFailure = new Error(`Concept plan structural mismatch for topic ${group.topicId}`);
    } catch (error) {
      if (!isTransientError(error)) {
        throw error;
      }
      lastFailure = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw new Error(
    `Concept planner failed for topic ${group.topicId} after ${config.bedrockMaxAttempts} attempts: ${lastFailure.message}`,
  );
}

export async function planConcepts(
  attributes: QuestionAttributes[],
  certification: Certification,
  correlationId: string,
): Promise<ConceptPlan> {
  const groups = groupSlotsByTopic(attributes);
  const results = await mapWithConcurrency(groups, config.bedrockConcurrency, async (group) =>
    planTopicGroup(group, certification, correlationId),
  );
  return results.flat();
}