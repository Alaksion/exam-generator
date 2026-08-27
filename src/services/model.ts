export type Provider = 'aws' | 'azure' | 'gcp';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type Role = 'customer' | 'admin';
export type ExamStatus = 'PENDING' | 'GENERATING' | 'READY' | 'FAILED';
export type TopicContext = string;

export interface DifficultyDistribution {
  easy: number;
  medium: number;
  hard: number;
}

export interface Topic {
  id: string;
  name: string;
  context: TopicContext;
}

export interface KnowledgeDomain {
  id: string;
  name: string;
  weight: number;
  topics: Topic[];
}

export interface CertificationConfig {
  questionCount: number;
  difficultyDistribution: DifficultyDistribution;
  domains: KnowledgeDomain[];
}

export interface Certification {
  id: string;
  provider: Provider;
  code: string;
  name: string;
  description: string;
  isActive: boolean;
  config: CertificationConfig;
}

export interface User {
  userId: string;
  email: string;
  role: Role;
  createdAt: string;
}

export interface AnswerOption {
  id: string;
  label: string;
  text: string;
  isCorrect: boolean;
}

export interface Question {
  id: string;
  number: number;
  domain: string;
  domainId: string;
  topic: string;
  topicId: string;
  difficulty: Difficulty;
  text: string;
  options: AnswerOption[];
  explanation: string;
  reference?: string;
  concept?: string;
}

export interface Exam {
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

export interface FullExam extends Exam {
  schemaVersion: string;
  questions: Question[];
}

export interface QuestionAttributes {
  number: number;
  difficulty: Difficulty;
  domain: string;
  domainId: string;
  topic: string;
  topicId: string;
  topicContext: TopicContext;
  concept?: string;
}

// ---------------------------------------------------------------------------
// Service inputs (produced by the HTTP layer, consumed by services)
// ---------------------------------------------------------------------------

export interface TopicInput {
  name: string;
  context: TopicContext;
}

export interface DomainInput {
  name: string;
  weight: number;
  topics: TopicInput[];
}

export interface CertificationConfigInput {
  questionCount: number;
  difficultyDistribution: DifficultyDistribution;
  domains: DomainInput[];
}

export interface CreateCertificationInput {
  provider: Provider;
  code: string;
  name: string;
  description: string;
  isActive: boolean;
  config: CertificationConfigInput;
}

export interface UpdateCertificationInput {
  name: string;
  description: string;
  isActive: boolean;
  config: CertificationConfigInput;
}

export interface ExamListQuery {
  status: ExamStatus;
  provider?: Provider;
  certificationId?: string;
  limit: number;
  cursor?: string;
}

export interface ListResult<T> {
  items: T[];
  nextCursor?: string;
}

// ---------------------------------------------------------------------------
// Service result views (mapped to HTTP DTOs downstream)
// ---------------------------------------------------------------------------

export interface CreatedExamView {
  id: string;
  status: ExamStatus;
}

export interface ExamStatusView {
  id: string;
  status: ExamStatus;
  createdAt: string;
  finishedAt: string | null;
}

export interface DownloadView {
  url: string;
  expiresAt: string;
}

export interface MeView {
  sub: string;
  email: string;
  role: Role;
  createdAt: string;
}

export interface PasswordResetResult {
  status: 'ok';
}

export interface ConceptPlanEntry {
  number: number;
  concept: string;
}

export type ConceptPlan = ConceptPlanEntry[];

export interface GenerationPlan {
  schemaVersion: string;
  questions: Question[];
  rawResponses: string[];
  plan?: ConceptPlanEntry[];
}