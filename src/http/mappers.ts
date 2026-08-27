import {
  type Certification,
  type CreateCertificationInput,
  type DownloadView,
  type ExamListQuery as ServiceExamListQuery,
  type ExamStatusView,
  type FullExam,
  type MeView,
  type UpdateCertificationInput,
  type User,
} from '../services/model.js';
import {
  type CertificationDto,
  type CreatedExamDto,
  type ExamDownloadDto,
  type ExamStatusDto,
  type FullExamDto,
  type MeDto,
  type UserDto,
  type CreateCertificationRequest,
  type UpdateCertificationRequest,
  type ExamListQuery,
} from './model.js';

export function toCertificationDto(certification: Certification): CertificationDto {
  return {
    id: certification.id,
    provider: certification.provider,
    code: certification.code,
    name: certification.name,
    description: certification.description,
    isActive: certification.isActive,
    config: {
      questionCount: certification.config.questionCount,
      difficultyDistribution: certification.config.difficultyDistribution,
      domains: certification.config.domains.map((domain) => ({
        id: domain.id,
        name: domain.name,
        weight: domain.weight,
        topics: domain.topics.map((topic) => ({
          id: topic.id,
          name: topic.name,
          context: topic.context,
        })),
      })),
    },
  };
}

export function toUserDto(user: User): UserDto {
  return {
    userId: user.userId,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
  };
}

export function toMeDto(view: MeView): MeDto {
  return {
    sub: view.sub,
    email: view.email,
    role: view.role,
    createdAt: view.createdAt,
  };
}

export function toCreatedExamDto(id: string, status: ExamStatusView['status']): CreatedExamDto {
  return { id, status };
}

export function toFullExamDto(exam: FullExam): FullExamDto {
  return {
    schemaVersion: exam.schemaVersion,
    id: exam.id,
    certificationId: exam.certificationId,
    ownerId: exam.ownerId,
    provider: exam.provider,
    title: exam.title,
    status: exam.status,
    createdAt: exam.createdAt,
    finishedAt: exam.finishedAt,
    s3KeyJson: exam.s3KeyJson,
    s3KeyPdf: exam.s3KeyPdf,
    questions: exam.questions.map((question) => ({
      id: question.id,
      number: question.number,
      domain: question.domain,
      domainId: question.domainId,
      topic: question.topic,
      topicId: question.topicId,
      difficulty: question.difficulty,
      text: question.text,
      options: question.options.map((option) => ({
        id: option.id,
        label: option.label,
        text: option.text,
        isCorrect: option.isCorrect,
      })),
      explanation: question.explanation,
      reference: question.reference,
      concept: question.concept,
    })),
  };
}

export function toExamStatusDto(view: ExamStatusView): ExamStatusDto {
  return {
    id: view.id,
    status: view.status,
    createdAt: view.createdAt,
    finishedAt: view.finishedAt,
  };
}

export function toExamDownloadDto(view: DownloadView): ExamDownloadDto {
  return {
    downloadUrl: view.url,
    expiresAt: view.expiresAt,
  };
}

export function toCreateCertificationInput(
  request: CreateCertificationRequest,
): CreateCertificationInput {
  return request;
}

export function toUpdateCertificationInput(
  request: UpdateCertificationRequest,
): UpdateCertificationInput {
  return request;
}

export function toExamListQuery(query: ExamListQuery): ServiceExamListQuery {
  return {
    status: query.status,
    provider: query.provider,
    certificationId: query.certificationId,
    limit: query.limit,
    cursor: query.cursor,
  };
}