import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { Certification, Exam, Difficulty } from '../types.js';

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
}

const bedrockClient = new BedrockRuntimeClient({});

export function renderPrompt(template: string, context: PromptContext): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = context[key as keyof PromptContext];
    return value !== undefined ? String(value) : _match;
  });
}

export function buildQuestionContexts(config: Certification['config']): QuestionAttributes[] {
  const { questionCount, difficultyDistribution, domains } = config;

  const easyCount = Math.round(difficultyDistribution.easy * questionCount);
  const mediumCount = Math.round(difficultyDistribution.medium * questionCount);
  const hardCount = Math.max(0, questionCount - easyCount - mediumCount);

  const difficulties: Difficulty[] = [];
  for (let i = 0; i < easyCount; i++) difficulties.push('easy');
  for (let i = 0; i < mediumCount; i++) difficulties.push('medium');
  for (let i = 0; i < hardCount; i++) difficulties.push('hard');

  return Array.from({ length: questionCount }, (_, index) => ({
    number: index + 1,
    difficulty: difficulties[index] ?? 'medium',
    domain: domains[index % domains.length],
  }));
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
    certification.config.modelId,
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
      certification.config.modelId,
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
