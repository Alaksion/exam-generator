import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseQuestion,
  parseExamQuestions,
  ParsedQuestionSchema,
  buildQuestionFormatSpec,
} from './questionParser.js';
import { certification } from '../../test/fixtures/certification.js';

let uuidCounter = 0;

vi.mock('uuid', () => ({
  v4: vi.fn(() => {
    uuidCounter += 1;
    return `uuid-${uuidCounter}`;
  }),
}));

beforeEach(() => {
  uuidCounter = 0;
  vi.clearAllMocks();
});

const validRawQuestion = {
  text: 'Which AWS service provides object storage?',
  options: [
    { label: 'A', text: 'Amazon S3', isCorrect: true },
    { label: 'B', text: 'Amazon EC2', isCorrect: false },
    { label: 'C', text: 'Amazon RDS', isCorrect: false },
    { label: 'D', text: 'Amazon CloudFront', isCorrect: false },
  ],
  explanation: 'Amazon S3 is the object storage service.',
  reference: 'https://docs.aws.amazon.com/s3/',
};

const context = {
  number: 1,
  difficulty: 'medium' as const,
  domain: 'Cloud Concepts',
  domainId: '22222222-2222-2222-2222-222222222222',
  topic: 'Amazon S3',
  topicId: '33333333-3333-3333-3333-333333333333',
  topicContext: certification.config.domains[0].topics.find((t) => t.name === 'Amazon S3')!.context,
};

const securityContext = {
  number: 2,
  difficulty: 'easy' as const,
  domain: 'Security',
  domainId: '55555555-5555-5555-5555-555555555555',
  topic: 'IAM',
  topicId: '66666666-6666-6666-6666-666666666666',
  topicContext: certification.config.domains.find((d) => d.name === 'Security')!.topics.find((t) => t.name === 'IAM')!.context,
};

describe('ParsedQuestionSchema', () => {
  it('accepts a valid question', () => {
    expect(ParsedQuestionSchema.safeParse(validRawQuestion).success).toBe(true);
  });

  it('rejects a question with no correct option', () => {
    const invalid = {
      ...validRawQuestion,
      options: validRawQuestion.options.map((option) => ({ ...option, isCorrect: false })),
    };
    expect(ParsedQuestionSchema.safeParse(invalid).success).toBe(false);
  });

  it('rejects a question with multiple correct options', () => {
    const invalid = {
      ...validRawQuestion,
      options: [
        { ...validRawQuestion.options[0], isCorrect: true },
        { ...validRawQuestion.options[1], isCorrect: true },
      ],
    };
    expect(ParsedQuestionSchema.safeParse(invalid).success).toBe(false);
  });

  it('rejects empty question text', () => {
    const invalid = { ...validRawQuestion, text: '' };
    expect(ParsedQuestionSchema.safeParse(invalid).success).toBe(false);
  });

  it('rejects an option with an empty label', () => {
    const invalid = {
      ...validRawQuestion,
      options: [{ ...validRawQuestion.options[0], label: '' }],
    };
    expect(ParsedQuestionSchema.safeParse(invalid).success).toBe(false);
  });
});

describe('buildQuestionFormatSpec', () => {
  it('produces valid JSON describing the parsed question schema', () => {
    const spec = buildQuestionFormatSpec();

    const parsed = JSON.parse(spec) as Record<string, unknown>;
    expect(parsed.text).toBeDefined();
    expect(parsed.options).toBeInstanceOf(Array);
    expect((parsed.options as Array<{ isCorrect: boolean }>).filter((o) => o.isCorrect)).toHaveLength(1);
    expect(parsed.explanation).toBeDefined();
    expect(parsed.reference).toBeDefined();
  });

  it('shares its field set with the parsing schema', () => {
    const spec = buildQuestionFormatSpec();
    const parsed = JSON.parse(spec) as Record<string, unknown>;
    const schemaFields = Object.keys(ParsedQuestionSchema.innerType().shape);

    expect(Object.keys(parsed).sort()).toEqual(schemaFields.slice().sort());
  });

  it('derives the option field set from the option schema element', () => {
    const spec = buildQuestionFormatSpec();
    const parsed = JSON.parse(spec) as { options: Array<Record<string, unknown>> };
    const optionSchemaFields = Object.keys(
      ParsedQuestionSchema.innerType().shape.options.element.shape,
    );

    expect(Object.keys(parsed.options[0]).sort()).toEqual(optionSchemaFields.slice().sort());
  });
});

describe('parseQuestion', () => {
  it('parses a JSON code block', () => {
    const raw = '```json\n' + JSON.stringify(validRawQuestion) + '\n```';
    const question = parseQuestion(raw, context);

    expect(question).not.toBeNull();
    expect(question?.text).toBe(validRawQuestion.text);
    expect(question?.number).toBe(context.number);
    expect(question?.domain).toBe(context.domain);
    expect(question?.domainId).toBe(context.domainId);
    expect(question?.topic).toBe(context.topic);
    expect(question?.topicId).toBe(context.topicId);
    expect(question?.difficulty).toBe(context.difficulty);
    expect(question?.options).toHaveLength(4);
    expect(question?.options[0].isCorrect).toBe(true);
    expect(question?.explanation).toBe(validRawQuestion.explanation);
    expect(question?.reference).toBe(validRawQuestion.reference);
  });

  it('parses a plain JSON object', () => {
    const raw = JSON.stringify(validRawQuestion);
    const question = parseQuestion(raw, context);

    expect(question).not.toBeNull();
    expect(question?.text).toBe(validRawQuestion.text);
  });

  it('extracts JSON from surrounding text', () => {
    const raw = `Here is your question: ${JSON.stringify(validRawQuestion)} Thanks!`;
    const question = parseQuestion(raw, context);

    expect(question).not.toBeNull();
    expect(question?.text).toBe(validRawQuestion.text);
  });

  it('returns null for non-JSON responses', () => {
    const question = parseQuestion('This is not JSON', context);
    expect(question).toBeNull();
  });

  it('returns null for invalid question data', () => {
    const raw = JSON.stringify({ text: 'Missing options' });
    expect(parseQuestion(raw, context)).toBeNull();
  });
});

describe('parseExamQuestions', () => {
  it('parses all questions and retries failed ones', async () => {
    const regenerate = vi.fn().mockResolvedValue(JSON.stringify(validRawQuestion));
    const rawResponses = [JSON.stringify(validRawQuestion), 'invalid json'];
    const contexts = [
      context,
      securityContext,
    ];

    const questions = await parseExamQuestions(rawResponses, contexts, regenerate);

    expect(questions).not.toBeNull();
    expect(questions).toHaveLength(2);
    expect(regenerate).toHaveBeenCalledTimes(1);
    expect(regenerate).toHaveBeenCalledWith(contexts[1]);
  });

  it('returns null when a question fails after retry', async () => {
    const regenerate = vi.fn().mockResolvedValue('still invalid');
    const rawResponses = [JSON.stringify(validRawQuestion), 'invalid json'];
    const contexts = [
      context,
      securityContext,
    ];

    const questions = await parseExamQuestions(rawResponses, contexts, regenerate);

    expect(questions).toBeNull();
    expect(regenerate).toHaveBeenCalledTimes(1);
  });

  it('returns null when contexts and responses length mismatch', async () => {
    const regenerate = vi.fn();
    const rawResponses = [JSON.stringify(validRawQuestion)];
    const contexts = [context, securityContext];

    const questions = await parseExamQuestions(rawResponses, contexts, regenerate);

    expect(questions).toBeNull();
    expect(regenerate).toHaveBeenCalledWith(contexts[1]);
  });
});
