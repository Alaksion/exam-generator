import { z } from 'zod';

const DIFFICULTY_SUM_TOLERANCE = 0.0001;

export const Provider = z.enum(['aws', 'azure', 'gcp']);
export type Provider = z.infer<typeof Provider>;

export const Difficulty = z.enum(['easy', 'medium', 'hard']);
export type Difficulty = z.infer<typeof Difficulty>;

export const DifficultyDistribution = z
  .object({
    easy: z.number().min(0).max(1),
    medium: z.number().min(0).max(1),
    hard: z.number().min(0).max(1),
  })
  .refine(
    (dist) => Math.abs(dist.easy + dist.medium + dist.hard - 1) < DIFFICULTY_SUM_TOLERANCE,
    () => ({ message: 'Difficulty weights must sum to 1.0' }),
  );

export const CertificationConfig = z.object({
  questionCount: z.number().int().min(1).max(100),
  difficultyDistribution: DifficultyDistribution,
  domains: z.array(z.string().min(1)).min(1),
  modelId: z.string().min(1),
  promptTemplate: z.string().min(1),
});

export const Certification = z.object({
  id: z.string().uuid(),
  provider: Provider,
  code: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string(),
  isActive: z.boolean(),
  config: CertificationConfig,
});
export type Certification = z.infer<typeof Certification>;

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
  difficulty: Difficulty,
  text: z.string().min(1),
  options: z.array(AnswerOption).min(2),
  explanation: z.string().min(1),
  reference: z.string().optional(),
});

export const ExamStatus = z.enum(['GENERATING', 'READY', 'FAILED']);
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
  questions: z.array(Question),
});
export type FullExam = z.infer<typeof FullExam>;

export const GeneratorMessage = z.object({
  examId: z.string().uuid(),
  certificationId: z.string().uuid(),
  correlationId: z.string().min(1),
});
export type GeneratorMessage = z.infer<typeof GeneratorMessage>;
