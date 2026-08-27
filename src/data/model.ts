import { z } from 'zod';

export const Provider = z.enum(['aws', 'azure', 'gcp']);
export type Provider = z.infer<typeof Provider>;

export const Difficulty = z.enum(['easy', 'medium', 'hard']);
export type Difficulty = z.infer<typeof Difficulty>;

export const Role = z.enum(['customer', 'admin']);
export type Role = z.infer<typeof Role>;

export const ExamStatus = z.enum(['PENDING', 'GENERATING', 'READY', 'FAILED']);
export type ExamStatus = z.infer<typeof ExamStatus>;

export const TopicContext = z.string().trim().min(20).max(1500);
export type TopicContext = z.infer<typeof TopicContext>;

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export const UserRecord = z.object({
  userId: z.string().min(1),
  email: z.string().trim().toLowerCase().min(1),
  role: Role,
  createdAt: z.string().datetime(),
});
export type UserRecord = z.infer<typeof UserRecord>;

// ---------------------------------------------------------------------------
// Certifications
// ---------------------------------------------------------------------------

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

export const TopicRecord = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  context: TopicContext,
});
export type TopicRecord = z.infer<typeof TopicRecord>;

export const KnowledgeDomainRecord = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  weight: z.number().int().min(1),
  topics: z.array(TopicRecord),
});
export type KnowledgeDomainRecord = z.infer<typeof KnowledgeDomainRecord>;

export const CertificationConfigRecord = z
  .object({
    questionCount: z.number().int().min(1).max(100),
    difficultyDistribution: DifficultyDistribution,
    domains: z.array(KnowledgeDomainRecord).min(1),
  })
  .superRefine((config, ctx) => {
    const sum = config.domains.reduce((acc, domain) => acc + domain.weight, 0);
    if (sum !== 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['domains'],
        message: 'Domain weights must sum to 100',
      });
    }
  });
export type CertificationConfigRecord = z.infer<typeof CertificationConfigRecord>;

export const CertificationRecord = z.object({
  id: z.string().uuid(),
  provider: Provider,
  code: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  isActive: z.boolean(),
  config: CertificationConfigRecord,
});
export type CertificationRecord = z.infer<typeof CertificationRecord>;

// ---------------------------------------------------------------------------
// Exams
// ---------------------------------------------------------------------------

export const ExamRecord = z.object({
  id: z.string().uuid(),
  certificationId: z.string().uuid(),
  ownerId: z.string().min(1),
  provider: Provider,
  title: z.string().min(1),
  status: ExamStatus,
  createdAt: z.string().datetime(),
  finishedAt: z.string().datetime().nullable(),
  s3KeyJson: z.string().optional(),
  s3KeyPdf: z.string().optional(),
});
export type ExamRecord = z.infer<typeof ExamRecord>;

// ---------------------------------------------------------------------------
// Canonical exam artifact (S3 JSON)
// ---------------------------------------------------------------------------

export const AnswerOptionRecord = z.object({
  id: z.string().uuid(),
  label: z.string().min(1),
  text: z.string().min(1),
  isCorrect: z.boolean(),
});
export type AnswerOptionRecord = z.infer<typeof AnswerOptionRecord>;

export const QuestionRecord = z.object({
  id: z.string().uuid(),
  number: z.number().int().positive(),
  domain: z.string().min(1),
  domainId: z.string().uuid(),
  topic: z.string().min(1),
  topicId: z.string().uuid(),
  difficulty: Difficulty,
  text: z.string().min(1),
  options: z.array(AnswerOptionRecord).min(2),
  explanation: z.string().min(1),
  reference: z.string().optional(),
  concept: z.string().optional(),
});
export type QuestionRecord = z.infer<typeof QuestionRecord>;

export const FullExamRecord = ExamRecord.extend({
  schemaVersion: z.string().min(1),
  questions: z.array(QuestionRecord),
});
export type FullExamRecord = z.infer<typeof FullExamRecord>;

// ---------------------------------------------------------------------------
// SQS generator message
// ---------------------------------------------------------------------------

export const GeneratorMessage = z.object({
  examId: z.string().uuid(),
  certificationId: z.string().uuid(),
  correlationId: z.string().min(1),
});
export type GeneratorMessage = z.infer<typeof GeneratorMessage>;

// ---------------------------------------------------------------------------
// Concept plan artifact (S3 plan.json, V2 only)
// ---------------------------------------------------------------------------

export const ConceptPlan = z.array(
  z.object({
    number: z.number().int().positive(),
    concept: z.string().min(1),
  }),
);
export type ConceptPlan = z.infer<typeof ConceptPlan>;