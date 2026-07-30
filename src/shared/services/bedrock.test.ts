import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  renderPrompt,
  buildQuestionContexts,
  buildPromptContext,
  regenerateQuestion,
  generateQuestionRaw,
  generateExamQuestions,
  PromptContext,
  QuestionAttributes,
} from './bedrock.js';
import { certification } from '../../test/fixtures/certification.js';

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: vi.fn(() => ({ send: sendMock })),
  InvokeModelCommand: vi.fn((input: unknown) => input),
}));

function makeBedrockResponse(text: string): { body: Uint8Array } {
  return {
    body: Uint8Array.from(Buffer.from(JSON.stringify({ content: [{ type: 'text', text }] }))),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('renderPrompt', () => {
  it('replaces brace-style variables', () => {
    const template =
      'Generate a {difficulty} question about {domain} for {certificationName} ({code}) question #{questionNumber}.';
    const context: PromptContext = {
      questionNumber: 1,
      difficulty: 'medium',
      domain: 'Cloud Concepts',
      certificationName: 'AWS Certified Cloud Practitioner',
      code: 'CLF-C02',
    };

    expect(renderPrompt(template, context)).toBe(
      'Generate a medium question about Cloud Concepts for AWS Certified Cloud Practitioner (CLF-C02) question #1.',
    );
  });

  it('leaves unknown variables unchanged', () => {
    const template = 'Unknown {unknownVariable} and {difficulty}';
    const context: PromptContext = {
      questionNumber: 1,
      difficulty: 'easy',
      domain: 'Security',
      certificationName: 'Test',
      code: 'CODE',
    };

    expect(renderPrompt(template, context)).toBe('Unknown {unknownVariable} and easy');
  });
});

describe('buildQuestionContexts', () => {
  it('distributes difficulty and domains across questions', () => {
    const attributes = buildQuestionContexts(certification.config);

    expect(attributes).toHaveLength(certification.config.questionCount);
    attributes.forEach((attr, index) => {
      expect(attr.number).toBe(index + 1);
      expect(certification.config.domains).toContain(attr.domain);
    });

    const easyCount = attributes.filter((attr) => attr.difficulty === 'easy').length;
    const mediumCount = attributes.filter((attr) => attr.difficulty === 'medium').length;
    const hardCount = attributes.filter((attr) => attr.difficulty === 'hard').length;

    expect(easyCount + mediumCount + hardCount).toBe(certification.config.questionCount);
  });

  it('cycles through multiple domains', () => {
    const config = {
      ...certification.config,
      domains: ['Cloud Concepts', 'Security', 'Billing'],
    };

    const attributes = buildQuestionContexts(config);

    expect(attributes[0].domain).toBe('Cloud Concepts');
    expect(attributes[1].domain).toBe('Security');
    expect(attributes[2].domain).toBe('Billing');
    expect(attributes[3].domain).toBe('Cloud Concepts');
  });
});

describe('buildPromptContext', () => {
  it('combines question attributes with certification metadata', () => {
    const attributes: QuestionAttributes = {
      number: 1,
      difficulty: 'medium',
      domain: 'Cloud Concepts',
    };

    const context = buildPromptContext(attributes, certification);

    expect(context).toEqual({
      questionNumber: 1,
      difficulty: 'medium',
      domain: 'Cloud Concepts',
      certificationName: certification.name,
      code: certification.code,
    });
  });
});

describe('regenerateQuestion', () => {
  it('renders and invokes Bedrock for a single question', async () => {
    sendMock.mockResolvedValue(makeBedrockResponse('retried question'));

    const attributes: QuestionAttributes = {
      number: 2,
      difficulty: 'easy',
      domain: 'Security',
    };

    const raw = await regenerateQuestion(attributes, certification, 'corr-retry');

    expect(raw).toBe('retried question');
    expect(sendMock).toHaveBeenCalledTimes(1);

    const calls = sendMock.mock.calls as Array<[unknown]>;
    const commandInput = calls[0][0] as { modelId: string; body: Buffer };
    expect(commandInput.modelId).toBe(certification.config.modelId);

    const requestBody = JSON.parse(commandInput.body.toString()) as { messages: Array<{ content: string }> };
    expect(requestBody.messages[0].content).toBe(
      'Generate a easy question about Security for exam CLF-C02.',
    );
  });
});

describe('generateQuestionRaw', () => {
  it('renders the prompt and returns the raw response text', async () => {
    sendMock.mockResolvedValue(makeBedrockResponse('raw question text'));

    const raw = await generateQuestionRaw(
      certification.config.modelId,
      certification.config.promptTemplate,
      {
        questionNumber: 1,
        difficulty: 'medium',
        domain: 'Cloud Concepts',
        certificationName: certification.name,
        code: certification.code,
      },
      'corr-123',
    );

    expect(raw).toBe('raw question text');
    expect(sendMock).toHaveBeenCalledTimes(1);

    const calls = sendMock.mock.calls as Array<[unknown]>;
    const commandInput = calls[0][0] as { modelId: string; body: Buffer };
    expect(commandInput.modelId).toBe(certification.config.modelId);

    const requestBody = JSON.parse(commandInput.body.toString()) as { messages: Array<{ content: string }> };
    expect(requestBody.messages[0].content).toBe(
      'Generate a medium question about Cloud Concepts for exam CLF-C02.',
    );
  });
});

describe('generateExamQuestions', () => {
  it('calls Bedrock once per question and returns raw responses', async () => {
    const questionCount = certification.config.questionCount;
    sendMock.mockResolvedValue(makeBedrockResponse('raw response'));

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

    const rawResponses = await generateExamQuestions(exam, certification, 'corr-789');

    expect(rawResponses).toHaveLength(questionCount);
    expect(rawResponses.every((r) => r === 'raw response')).toBe(true);
    expect(sendMock).toHaveBeenCalledTimes(questionCount);
  });
});
