import { z } from 'zod';

export const Provider = z.enum(['aws', 'azure', 'gcp']);
export type Provider = z.infer<typeof Provider>;

export const Difficulty = z.enum(['easy', 'medium', 'hard']);
export type Difficulty = z.infer<typeof Difficulty>;

export const DifficultyDistribution = z
  .object({
    easy: z.number().int().min(0),
    medium: z.number().int().min(0),
    hard: z.number().int().min(0),
  })
  .superRefine((dist, ctx) => {
    if (dist.easy + dist.medium + dist.hard !== 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Difficulty weights must sum to 100',
      });
    }
  });
export type DifficultyDistribution = z.infer<typeof DifficultyDistribution>;

export const TopicContext = z.string().trim().min(20).max(1500);
export type TopicContext = z.infer<typeof TopicContext>;

export const Topic = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  context: TopicContext,
});
export type Topic = z.infer<typeof Topic>;

export const TopicInput = z.object({
  name: z.string().min(1),
  context: TopicContext,
});
export type TopicInput = z.infer<typeof TopicInput>;

export const KnowledgeDomain = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  weight: z.number().int().min(1),
  topics: z.array(Topic),
});
export type KnowledgeDomain = z.infer<typeof KnowledgeDomain>;

function domainsSumTo100(domains: Array<{ weight: number }>, ctx: z.RefinementCtx): void {
  const sum = domains.reduce((acc, domain) => acc + domain.weight, 0);
  if (sum !== 100) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['domains'],
      message: 'Domain weights must sum to 100',
    });
  }
}

export const CertificationConfig = z
  .object({
    questionCount: z.number().int().min(1).max(100),
    difficultyDistribution: DifficultyDistribution,
    domains: z.array(KnowledgeDomain).min(1),
  })
  .superRefine((config, ctx) => domainsSumTo100(config.domains, ctx));
export type CertificationConfig = z.infer<typeof CertificationConfig>;

export const Certification = z.object({
  id: z.string().uuid(),
  provider: Provider,
  code: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  isActive: z.boolean(),
  config: CertificationConfig,
});
export type Certification = z.infer<typeof Certification>;

export const DomainInput = z.object({
  name: z.string().min(1),
  weight: z.number().int().min(1),
  topics: z.array(TopicInput),
});
export type DomainInput = z.infer<typeof DomainInput>;

export const CertificationConfigInput = z
  .object({
    questionCount: z.number().int().min(1).max(100),
    difficultyDistribution: DifficultyDistribution,
    domains: z.array(DomainInput).min(1),
  })
  .superRefine((config, ctx) => domainsSumTo100(config.domains, ctx));
export type CertificationConfigInput = z.infer<typeof CertificationConfigInput>;

export const AnswerOption = z.object({
  id: z.string().uuid(),
  label: z.string().min(1),
  text: z.string().min(1),
  isCorrect: z.boolean(),
});

export const Question = z.object({
  id: z.string().uuid(),
  number: z.number().int().positive(),
  domain: z.string().min(1),
  domainId: z.string().uuid(),
  topic: z.string().min(1),
  topicId: z.string().uuid(),
  difficulty: Difficulty,
  text: z.string().min(1),
  options: z.array(AnswerOption).min(2),
  explanation: z.string().min(1),
  reference: z.string().optional(),
});
export type Question = z.infer<typeof Question>;

export const ExamStatus = z.enum(['PENDING', 'GENERATING', 'READY', 'FAILED']);
export type ExamStatus = z.infer<typeof ExamStatus>;

export const Exam = z.object({
  id: z.string().uuid(),
  certificationId: z.string().uuid(),
  provider: Provider,
  title: z.string().min(1),
  status: ExamStatus,
  createdAt: z.string().datetime(),
  finishedAt: z.string().datetime().nullable(),
  s3KeyJson: z.string().optional(),
  s3KeyPdf: z.string().optional(),
});
export type Exam = z.infer<typeof Exam>;

export const FullExam = Exam.extend({
  schemaVersion: z.string().min(1),
  questions: z.array(Question),
});
export type FullExam = z.infer<typeof FullExam>;

export const GeneratorMessage = z.object({
  examId: z.string().uuid(),
  certificationId: z.string().uuid(),
  correlationId: z.string().min(1),
});
export type GeneratorMessage = z.infer<typeof GeneratorMessage>;

export interface QuestionAttributes {
  number: number;
  difficulty: Difficulty;
  domain: string;
  domainId: string;
  topic: string;
  topicId: string;
  topicContext: TopicContext;
}
