import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared API vocabulary
// ---------------------------------------------------------------------------

export const Role = z.enum(['customer', 'admin']);
export type Role = z.infer<typeof Role>;

export const Provider = z.enum(['aws', 'azure', 'gcp']);
export type Provider = z.infer<typeof Provider>;

export const Difficulty = z.enum(['easy', 'medium', 'hard']);
export type Difficulty = z.infer<typeof Difficulty>;

export const ExamStatus = z.enum(['PENDING', 'GENERATING', 'READY', 'FAILED']);
export type ExamStatus = z.infer<typeof ExamStatus>;

// ---------------------------------------------------------------------------
// Request schemas
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

export const TopicContext = z.string().trim().min(20).max(1500);
export type TopicContext = z.infer<typeof TopicContext>;

export const TopicInput = z.object({
  name: z.string().min(1),
  context: TopicContext,
});
export type TopicInput = z.infer<typeof TopicInput>;

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
export type CertificationConfigInput = z.infer<typeof CertificationConfigInput>;

export const CreateCertificationRequest = z.object({
  provider: Provider,
  code: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  isActive: z.boolean(),
  config: CertificationConfigInput,
});
export type CreateCertificationRequest = z.infer<typeof CreateCertificationRequest>;

export const UpdateCertificationRequest = z.object({
  name: z.string().min(1),
  description: z.string(),
  isActive: z.boolean(),
  config: CertificationConfigInput,
});
export type UpdateCertificationRequest = z.infer<typeof UpdateCertificationRequest>;

export const RequestExamGeneration = z.object({
  certificationId: z.string().uuid(),
});
export type RequestExamGeneration = z.infer<typeof RequestExamGeneration>;

export const ForgotPasswordRequest = z.object({
  email: z.string().trim().toLowerCase().email(),
});
export type ForgotPasswordRequest = z.infer<typeof ForgotPasswordRequest>;

export const UpdateUserRoleRequest = z.object({ role: Role });
export type UpdateUserRoleRequest = z.infer<typeof UpdateUserRoleRequest>;

export const ExamListQuery = z.object({
  status: ExamStatus.default('READY'),
  provider: Provider.optional(),
  certificationId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
});
export type ExamListQuery = z.infer<typeof ExamListQuery>;

export const AdminUserListQuery = z.object({
  email: z.string().min(1).optional(),
  sub: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
});
export type AdminUserListQuery = z.infer<typeof AdminUserListQuery>;

// ---------------------------------------------------------------------------
// Response DTOs
// ---------------------------------------------------------------------------

export interface CertificationDto {
  id: string;
  provider: Provider;
  code: string;
  name: string;
  description: string;
  isActive: boolean;
  config: {
    questionCount: number;
    difficultyDistribution: DifficultyDistribution;
    domains: Array<{
      id: string;
      name: string;
      weight: number;
      topics: Array<{ id: string; name: string; context: string }>;
    }>;
  };
}

export interface UserDto {
  userId: string;
  email: string;
  role: Role;
  createdAt: string;
}

export interface MeDto {
  sub: string;
  email: string;
  role: Role;
  createdAt: string;
}

export interface CreatedExamDto {
  id: string;
  status: ExamStatus;
}

export interface ExamDto {
  id: string;
  certificationId: string;
  ownerId: string;
  provider: Provider;
  title: string;
  status: ExamStatus;
  createdAt: string;
  finishedAt: string | null;
  s3KeyJson?: string;
  s3KeyPdf?: string;
}

export interface FullExamDto {
  schemaVersion: string;
  id: string;
  certificationId: string;
  ownerId: string;
  provider: Provider;
  title: string;
  status: ExamStatus;
  createdAt: string;
  finishedAt: string | null;
  s3KeyJson?: string;
  s3KeyPdf?: string;
  questions: Array<{
    id: string;
    number: number;
    domain: string;
    domainId: string;
    topic: string;
    topicId: string;
    difficulty: Difficulty;
    text: string;
    options: Array<{ id: string; label: string; text: string; isCorrect: boolean }>;
    explanation: string;
    reference?: string;
    concept?: string;
  }>;
}

export interface ExamStatusDto {
  id: string;
  status: ExamStatus;
  createdAt: string;
  finishedAt: string | null;
}

export interface ExamDownloadDto {
  downloadUrl: string;
  expiresAt: string;
}

export interface ListResponse<T> {
  items: T[];
  cursor: {
    nextCursor: string | null;
    hasNextPage: boolean;
  };
}