import { v4 as uuidv4 } from 'uuid';
import {
  deleteExam as deleteExamRecord,
  getExamById as getRecordById,
  listExams as listExamRecords,
  type ListExamsFilters,
} from '../data/datasources/exams.js';
import {
  deleteArtifacts,
  getCanonicalExam,
  getPresignedDownloadUrl,
} from '../data/datasources/artifacts.js';
import { type ExamRecord, type FullExamRecord } from '../data/model.js';
import { ConflictError, ExamNotFoundError, ExamNotReadyError, NotFoundError } from './errors.js';
import {
  type Certification,
  type DownloadView,
  type Exam,
  type ExamStatus,
  type FullExam,
  type ListResult,
  type Question,
} from './model.js';

export function mapExamRecordToExam(record: ExamRecord): Exam {
  return {
    id: record.id,
    certificationId: record.certificationId,
    ownerId: record.ownerId,
    provider: record.provider,
    title: record.title,
    status: record.status,
    createdAt: record.createdAt,
    finishedAt: record.finishedAt,
    s3KeyJson: record.s3KeyJson,
    s3KeyPdf: record.s3KeyPdf,
  };
}

export function mapFullExamRecordToFullExam(record: FullExamRecord): FullExam {
  return {
    ...mapExamRecordToExam(record),
    schemaVersion: record.schemaVersion,
    questions: record.questions,
  };
}

export function generateExamTitle(certification: Certification, timestamp: Date): string {
  return `${certification.name} - Practice Exam ${timestamp.toISOString()}`;
}

export function createExam(certification: Certification, ownerId: string, now = new Date()): Exam {
  return {
    id: uuidv4(),
    certificationId: certification.id,
    ownerId,
    provider: certification.provider,
    title: generateExamTitle(certification, now),
    status: 'PENDING',
    createdAt: now.toISOString(),
    finishedAt: null,
    s3KeyJson: undefined,
    s3KeyPdf: undefined,
  };
}

type TransitionTarget = Exclude<ExamStatus, 'PENDING'>;

const NEXT_STATUS: Record<ExamStatus, readonly TransitionTarget[]> = {
  PENDING: ['GENERATING', 'FAILED'],
  GENERATING: ['READY', 'FAILED'],
  READY: [],
  FAILED: [],
};

export function transitionExamStatus(
  exam: Exam,
  newStatus: TransitionTarget,
  now = new Date(),
): Exam {
  if (!NEXT_STATUS[exam.status].includes(newStatus)) {
    throw new ConflictError(`Cannot transition exam from ${exam.status} to ${newStatus}.`);
  }

  const terminal = newStatus === 'READY' || newStatus === 'FAILED';

  return {
    ...exam,
    status: newStatus,
    finishedAt: terminal ? now.toISOString() : exam.finishedAt,
  };
}

export async function getExamById(id: string): Promise<Exam | null> {
  const record = await getRecordById(id);
  return record ? mapExamRecordToExam(record) : null;
}

export async function getExamOrThrow(id: string): Promise<Exam> {
  const exam = await getExamById(id);
  if (!exam) {
    throw new ExamNotFoundError();
  }
  return exam;
}

export async function getOwnedExamOrThrow(id: string, subject: string): Promise<Exam> {
  const exam = await getExamOrThrow(id);
  if (exam.ownerId !== subject) {
    throw new NotFoundError('Exam');
  }
  return exam;
}

export async function listExams(filters: ListExamsFilters): Promise<ListResult<Exam>> {
  const { exams, nextCursor } = await listExamRecords(filters);
  return { items: exams.map(mapExamRecordToExam), nextCursor };
}

export async function getFullExam(exam: Exam): Promise<FullExam> {
  if (exam.status !== 'READY' || !exam.s3KeyJson) {
    throw new ExamNotReadyError();
  }
  const record = await getCanonicalExam(exam.s3KeyJson);
  return mapFullExamRecordToFullExam(record);
}

export async function getDownload(exam: Exam): Promise<DownloadView> {
  if (exam.status !== 'READY' || !exam.s3KeyPdf) {
    throw new ExamNotReadyError();
  }
  return getPresignedDownloadUrl(exam.s3KeyPdf);
}

export async function deleteExam(exam: Exam): Promise<void> {
  const s3Keys = [exam.s3KeyJson, exam.s3KeyPdf].filter((key): key is string => Boolean(key));
  if (s3Keys.length > 0) {
    await deleteArtifacts(s3Keys);
  }
  await deleteExamRecord(exam.id);
}

export function toFullExam(
  exam: Exam,
  schemaVersion: string,
  questions: Question[],
  s3KeyJson: string,
  s3KeyPdf: string,
): FullExam {
  return {
    ...exam,
    schemaVersion,
    questions,
    s3KeyJson,
    s3KeyPdf,
  };
}