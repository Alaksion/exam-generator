import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import type { Question, QuestionAttributes } from '../types.js';

export const ParsedQuestionSchema = z
  .object({
    text: z.string().min(1),
    options: z
      .array(
        z.object({
          label: z.string().min(1),
          text: z.string().min(1),
          isCorrect: z.boolean(),
        }),
      )
      .min(2),
    explanation: z.string().min(1),
    reference: z.string().optional(),
  })
  .refine((question) => question.options.filter((option) => option.isCorrect).length === 1, {
    message: 'Exactly one option must be correct',
  });

export function buildQuestionFormatSpec(): string {
  const inner = ParsedQuestionSchema.innerType();
  const topLevelKeys = Object.keys(inner.shape);
  const optionKeys = Object.keys(inner.shape.options.element.shape);
  const example: Record<string, unknown> = {};

  for (const key of topLevelKeys) {
    if (key === 'text') {
      example[key] = '<the question text>';
    } else if (key === 'options') {
      example[key] = [
        buildOptionExample(optionKeys, true),
        buildOptionExample(optionKeys, false),
        buildOptionExample(optionKeys, false),
        buildOptionExample(optionKeys, false),
      ];
    } else if (key === 'explanation') {
      example[key] = '<explanation of the correct answer>';
    } else if (key === 'reference') {
      example[key] = '<optional link to official documentation>';
    }
  }

  return JSON.stringify(example, null, 2);
}

function buildOptionExample(keys: string[], isCorrect: boolean): Record<string, unknown> {
  const option: Record<string, unknown> = {};
  for (const key of keys) {
    if (key === 'label') {
      option[key] = 'A';
    } else if (key === 'text') {
      option[key] = '<option text>';
    } else if (key === 'isCorrect') {
      option[key] = isCorrect;
    }
  }
  return option;
}

export function parseQuestion(rawResponse: string, context: QuestionAttributes): Question | null {
  const parsed = extractJson(rawResponse);
  if (!parsed) {
    return null;
  }

  const validated = ParsedQuestionSchema.safeParse(parsed);
  if (!validated.success) {
    return null;
  }

  const question = validated.data;
  return {
    id: uuidv4(),
    number: context.number,
    domain: context.domain,
    domainId: context.domainId,
    topic: context.topic,
    topicId: context.topicId,
    difficulty: context.difficulty,
    text: question.text,
    options: question.options.map((option) => ({
      id: uuidv4(),
      label: option.label,
      text: option.text,
      isCorrect: option.isCorrect,
    })),
    explanation: question.explanation,
    reference: question.reference,
    concept: context.concept,
  };
}

export async function parseExamQuestions(
  rawResponses: string[],
  contexts: QuestionAttributes[],
  regenerate: (context: QuestionAttributes) => Promise<string>,
): Promise<Question[] | null> {
  const questions: Question[] = [];

  for (let index = 0; index < contexts.length; index++) {
    const context = contexts[index];
    const rawResponse = rawResponses[index] ?? '';

    let question = parseQuestion(rawResponse, context);
    if (!question) {
      const retryResponse = await regenerate(context);
      question = parseQuestion(retryResponse, context);
    }

    if (!question) {
      return null;
    }

    questions.push(question);
  }

  return questions;
}

function extractJson(rawResponse: string): unknown {
  try {
    const codeBlockMatch = rawResponse.match(/```(?:json)?\n?([\s\S]*?)\n?```/);
    if (codeBlockMatch) {
      return JSON.parse(codeBlockMatch[1]);
    }

    const startIndex = rawResponse.indexOf('{');
    const endIndex = rawResponse.lastIndexOf('}');
    if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
      return JSON.parse(rawResponse.slice(startIndex, endIndex + 1));
    }

    return null;
  } catch {
    return null;
  }
}
