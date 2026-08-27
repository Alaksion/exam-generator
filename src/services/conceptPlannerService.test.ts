import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ConceptPlanSchema,
  buildConceptPlanFormatSpec,
  buildConceptPlanPrompt,
  groupSlotsByTopic,
  parseConceptPlan,
  verifyPlanNumberSet,
  zipConcepts,
  planConcepts,
  CONCEPT_PLAN_PROMPT_TEMPLATE,
  PlannerTopicGroup,
} from './conceptPlannerService.js';
import { certification } from '../test/fixtures/certification.js';
import { QuestionAttributes } from './model.js';
import * as bedrockData from '../data/datasources/bedrock.js';

vi.mock('../data/datasources/bedrock.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data/datasources/bedrock.js')>();
  return {
    ...actual,
    invokeModel: vi.fn(),
  };
});

const mockedInvokeModel = vi.mocked(bedrockData.invokeModel);

const cloud = certification.config.domains.find((d) => d.name === 'Cloud Concepts')!;
const security = certification.config.domains.find((d) => d.name === 'Security')!;
const s3 = cloud.topics.find((t) => t.name === 'Amazon S3')!;
const ec2 = cloud.topics.find((t) => t.name === 'Amazon EC2')!;
const iam = security.topics.find((t) => t.name === 'IAM')!;

function makeAttributes(): QuestionAttributes[] {
  return [
    {
      number: 1,
      difficulty: 'easy',
      domain: cloud.name,
      domainId: cloud.id,
      topic: s3.name,
      topicId: s3.id,
      topicContext: s3.context,
    },
    {
      number: 2,
      difficulty: 'medium',
      domain: cloud.name,
      domainId: cloud.id,
      topic: s3.name,
      topicId: s3.id,
      topicContext: s3.context,
    },
    {
      number: 3,
      difficulty: 'medium',
      domain: cloud.name,
      domainId: cloud.id,
      topic: ec2.name,
      topicId: ec2.id,
      topicContext: ec2.context,
    },
    {
      number: 4,
      difficulty: 'hard',
      domain: security.name,
      domainId: security.id,
      topic: iam.name,
      topicId: iam.id,
      topicContext: iam.context,
    },
  ];
}

const attributes = makeAttributes();

function planResponseFor(numbers: number[]): string {
  return JSON.stringify(numbers.map((number) => ({ number, concept: `concept-for-${number}` })));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ConceptPlanSchema', () => {
  it('accepts a valid list of number/concept entries', () => {
    expect(ConceptPlanSchema.safeParse([{ number: 1, concept: 'lifecycle transitions' }]).success).toBe(true);
  });

  it('rejects an entry without a concept', () => {
    expect(ConceptPlanSchema.safeParse([{ number: 1 }]).success).toBe(false);
  });

  it('rejects an empty concept', () => {
    expect(ConceptPlanSchema.safeParse([{ number: 1, concept: '' }]).success).toBe(false);
  });

  it('rejects a non-positive number', () => {
    expect(ConceptPlanSchema.safeParse([{ number: 0, concept: 'x' }]).success).toBe(false);
  });

  it('rejects a non-array output', () => {
    expect(ConceptPlanSchema.safeParse({ number: 1, concept: 'x' }).success).toBe(false);
  });
});

describe('buildConceptPlanFormatSpec', () => {
  it('produces a valid JSON array whose entries carry exactly the schema field set', () => {
    const spec = buildConceptPlanFormatSpec();
    const parsed = JSON.parse(spec) as Array<Record<string, unknown>>;
    expect(Array.isArray(parsed)).toBe(true);
    const schemaFields = Object.keys(ConceptPlanSchema.element.shape).sort();
    expect(Object.keys(parsed[0]).sort()).toEqual(schemaFields);
  });
});

describe('groupSlotsByTopic', () => {
  it('groups attributes by topicId preserving slot order', () => {
    const groups = groupSlotsByTopic(attributes);
    expect(groups).toHaveLength(3);
    expect(groups.map((g) => g.topicId).sort()).toEqual([s3.id, ec2.id, iam.id].sort());

    const s3Group = groups.find((g) => g.topicId === s3.id)!;
    expect(s3Group.questions.map((q) => q.number)).toEqual([1, 2]);
    expect(s3Group.topic).toBe('Amazon S3');
    expect(s3Group.topicContext).toBe(s3.context);
  });
});

describe('buildConceptPlanPrompt', () => {
  const group: PlannerTopicGroup = {
    topicId: s3.id,
    topic: s3.name,
    topicContext: s3.context,
    questions: attributes.filter((a) => a.topicId === s3.id),
  };

  it('embeds certification, topic, topic context, numbers, and the derived format spec', () => {
    const prompt = buildConceptPlanPrompt(group, certification);

    expect(prompt).toContain(certification.name);
    expect(prompt).toContain(certification.code);
    expect(prompt).toContain('Amazon S3');
    expect(prompt).toContain(s3.context);
    expect(prompt).toContain('1, 2');
    expect(prompt).toContain(buildConceptPlanFormatSpec());
    expect(prompt).not.toContain('{topicContext}');
    expect(prompt).not.toContain('{numbers}');
  });

  it('renders a single centralized template constant', () => {
    expect(typeof CONCEPT_PLAN_PROMPT_TEMPLATE).toBe('string');
    expect(CONCEPT_PLAN_PROMPT_TEMPLATE.length).toBeGreaterThan(0);
  });
});

describe('parseConceptPlan', () => {
  it('parses a JSON code block', () => {
    const raw = '```json\n' + JSON.stringify([{ number: 1, concept: 'lifecycle' }]) + '\n```';
    expect(parseConceptPlan(raw)).toEqual([{ number: 1, concept: 'lifecycle' }]);
  });

  it('parses a plain JSON array', () => {
    const raw = JSON.stringify([{ number: 2, concept: 'replication' }]);
    expect(parseConceptPlan(raw)).toEqual([{ number: 2, concept: 'replication' }]);
  });

  it('returns null for non-JSON responses', () => {
    expect(parseConceptPlan('not json')).toBeNull();
  });

  it('returns null for malformed plan data', () => {
    expect(parseConceptPlan(JSON.stringify([{ number: 'one' }]))).toBeNull();
  });
});

describe('verifyPlanNumberSet', () => {
  const plan = [
    { number: 1, concept: 'a' },
    { number: 2, concept: 'b' },
  ];

  it('returns true when the number sets match exactly', () => {
    expect(verifyPlanNumberSet(plan, [1, 2])).toBe(true);
    expect(verifyPlanNumberSet(plan, [2, 1])).toBe(true);
  });

  it('returns false when a number is missing', () => {
    expect(verifyPlanNumberSet(plan, [1])).toBe(false);
  });

  it('returns false when an extra number is present', () => {
    expect(verifyPlanNumberSet(plan, [1, 2, 3])).toBe(false);
  });

  it('returns false when a number is out of range', () => {
    expect(verifyPlanNumberSet(plan, [1, 3])).toBe(false);
  });
});

describe('zipConcepts', () => {
  it('assigns each slot its concept by number', () => {
    const zipped = zipConcepts(attributes, [
      { number: 1, concept: 'lifecycle' },
      { number: 2, concept: 'replication' },
      { number: 3, concept: 'reserved instances' },
      { number: 4, concept: 'roles' },
    ]);

    expect(zipped.map((a) => a.concept)).toEqual([
      'lifecycle',
      'replication',
      'reserved instances',
      'roles',
    ]);
    expect(zipped.map((a) => a.number)).toEqual([1, 2, 3, 4]);
  });

  it('leaves slots without a matching plan entry without a concept', () => {
    const zipped = zipConcepts(attributes, [{ number: 1, concept: 'lifecycle' }]);
    expect(zipped[0].concept).toBe('lifecycle');
    expect(zipped[1].concept).toBeUndefined();
  });
});

describe('planConcepts', () => {
  it('issues one planner call per topic group and returns the full 1:1 plan', async () => {
    mockedInvokeModel.mockImplementation(async ({ text }) => {
      const match = text.match(/Question numbers to cover: ([\d, ]+)/);
      const numbers = match ? match[1].split(',').map((n) => Number(n.trim())) : [];
      return planResponseFor(numbers);
    });

    const plan = await planConcepts(attributes, certification, 'corr-plan');

    expect(plan).toHaveLength(4);
    expect(plan.map((p) => p.number).sort()).toEqual([1, 2, 3, 4]);
    expect(mockedInvokeModel).toHaveBeenCalledTimes(3);
  });

  it('retries a structurally mismatched plan and succeeds on a later attempt', async () => {
    const singleTopic = attributes.filter((a) => a.topicId === s3.id);
    let call = 0;
    mockedInvokeModel.mockImplementation(async () => {
      call += 1;
      if (call <= 2) {
        return JSON.stringify([{ number: 999, concept: 'wrong' }]);
      }
      return planResponseFor([1, 2]);
    });

    const plan = await planConcepts(singleTopic, certification, 'corr-retry');
    expect(plan).toEqual([
      { number: 1, concept: 'concept-for-1' },
      { number: 2, concept: 'concept-for-2' },
    ]);
    expect(mockedInvokeModel).toHaveBeenCalledTimes(3);
  });

  it('hard-fails after the attempt budget is exhausted on structural mismatch', async () => {
    const callTopic = attributes.filter((a) => a.topicId === s3.id);
    mockedInvokeModel.mockResolvedValue(JSON.stringify([{ number: 999, concept: 'wrong' }]));

    await expect(planConcepts(callTopic, certification, 'corr-fail')).rejects.toThrow(
      'Concept planner failed',
    );
    expect(mockedInvokeModel).toHaveBeenCalledTimes(3);
  });

  it('hard-fails on malformed JSON output after the attempt budget is exhausted', async () => {
    const malformedTopic = attributes.filter((a) => a.topicId === s3.id);
    mockedInvokeModel.mockResolvedValue('this is not JSON');

    await expect(planConcepts(malformedTopic, certification, 'corr-malformed')).rejects.toThrow(
      'Concept planner failed',
    );
    expect(mockedInvokeModel).toHaveBeenCalledTimes(3);
  });

  it('fails fast on a non-transient Bedrock error without burning the retry budget', async () => {
    const throwingTopic = attributes.filter((a) => a.topicId === s3.id);
    mockedInvokeModel.mockRejectedValue(new Error('bedrock boom'));

    await expect(planConcepts(throwingTopic, certification, 'corr-throw')).rejects.toThrow(
      'bedrock boom',
    );
    expect(mockedInvokeModel).toHaveBeenCalledTimes(1);
  });

  it('retries transient Bedrock errors within the attempt budget', async () => {
    const transientTopic = attributes.filter((a) => a.topicId === s3.id);
    mockedInvokeModel
      .mockRejectedValueOnce(Object.assign(new Error('throttled'), { name: 'ThrottlingException' }))
      .mockResolvedValueOnce(planResponseFor([1, 2]));

    const plan = await planConcepts(transientTopic, certification, 'corr-transient');

    expect(plan).toEqual([
      { number: 1, concept: 'concept-for-1' },
      { number: 2, concept: 'concept-for-2' },
    ]);
    expect(mockedInvokeModel).toHaveBeenCalledTimes(2);
  });
});