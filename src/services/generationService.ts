import { config } from '../shared/config.js';
import { getExamById, updateExamStatus } from '../data/datasources/exams.js';
import { putArtifact } from '../data/datasources/artifacts.js';
import { type GeneratorMessage } from '../data/model.js';
import { getCertificationById } from './certificationService.js';
import {
  buildQuestionContexts,
  generateExamQuestions,
  generateExamQuestionsV2,
  regenerateQuestion,
} from './bedrockService.js';
import { parseExamQuestions } from './questionParserService.js';
import { renderExamPdf } from './pdfService.js';
import { transitionExamStatus, toFullExam } from './examService.js';
import type { ConceptPlan, FullExam, QuestionAttributes } from './model.js';

export const CANONICAL_EXAM_SCHEMA_VERSION = '2.0.0';
export const CANONICAL_EXAM_SCHEMA_VERSION_V2 = '3.0.0';

export function buildArtifactKeys(examId: string): {
  s3KeyJson: string;
  s3KeyPdf: string;
  s3KeyRaw: string;
  s3KeyPlan: string;
} {
  return {
    s3KeyJson: `exams/${examId}/exam.json`,
    s3KeyPdf: `exams/${examId}/exam.pdf`,
    s3KeyRaw: `exams/${examId}/raw.json`,
    s3KeyPlan: `exams/${examId}/plan.json`,
  };
}

export async function processGenerationMessage(message: GeneratorMessage): Promise<void> {
  console.info('Processing message', { examId: message.examId, correlationId: message.correlationId });

  const exam = await getExamById(message.examId);
  if (!exam) {
    console.warn('Exam not found, skipping record', { examId: message.examId });
    return;
  }

  if (exam.status !== 'PENDING') {
    console.info('Exam is not pending, aborting record to prevent duplicate generation', {
      examId: exam.id,
      status: exam.status,
    });
    return;
  }

  const claimed = await claimPendingExam(exam.id);
  if (!claimed) {
    console.info('Failed to claim exam for generation, another worker is already generating', {
      examId: exam.id,
    });
    return;
  }
  const generating = transitionExamStatus(exam, 'GENERATING');

  try {
    const certification = await getCertificationById(message.certificationId);
    if (!certification) {
      throw new Error('Certification not found');
    }

    let rawResponses: string[];
    let contexts: QuestionAttributes[];
    let resultPlan: ConceptPlan | undefined;
    const v2 = config.examGenerationV2;
    if (v2) {
      const result = await generateExamQuestionsV2(generating, certification, message.correlationId);
      rawResponses = result.rawResponses;
      contexts = result.contexts;
      resultPlan = result.plan;
    } else {
      rawResponses = await generateExamQuestions(generating, certification, message.correlationId);
      contexts = buildQuestionContexts(certification.config);
    }

    const questions = await parseExamQuestions(rawResponses, contexts, async (context) =>
      regenerateQuestion(context, certification, message.correlationId),
    );
    if (!questions) {
      throw new Error('Question parsing failed after retry');
    }

    const { s3KeyJson, s3KeyPdf, s3KeyRaw, s3KeyPlan } = buildArtifactKeys(exam.id);
    const now = new Date();
    const transitioned = transitionExamStatus(generating, 'READY', now);
    const schemaVersion = v2 ? CANONICAL_EXAM_SCHEMA_VERSION_V2 : CANONICAL_EXAM_SCHEMA_VERSION;

    const fullExam: FullExam = toFullExam(
      transitioned,
      schemaVersion,
      questions,
      s3KeyJson,
      s3KeyPdf,
    );

    await putArtifact(s3KeyRaw, JSON.stringify(rawResponses), 'application/json');
    await putArtifact(s3KeyJson, JSON.stringify(fullExam), 'application/json');
    if (resultPlan) {
      await putArtifact(s3KeyPlan, JSON.stringify(resultPlan), 'application/json');
    }

    const pdfBuffer = await renderExamPdf(fullExam);
    await putArtifact(s3KeyPdf, pdfBuffer, 'application/pdf');

    await updateExamStatus(exam.id, 'READY', {
      finishedAt: transitioned.finishedAt,
      s3KeyJson,
      s3KeyPdf,
    });
  } catch (error) {
    await failExam(exam.id, generating, message.correlationId, error);
  }
}

async function claimPendingExam(examId: string): Promise<boolean> {
  return updateExamStatus(examId, 'GENERATING', {}, 'PENDING');
}

async function failExam(
  examId: string,
  generating: ReturnType<typeof transitionExamStatus>,
  correlationId: string,
  error: unknown,
): Promise<void> {
  const failed = transitionExamStatus(generating, 'FAILED', new Date());
  console.error('Exam generation failed', {
    examId,
    correlationId,
    error: error instanceof Error ? error.message : error,
  });
  await updateExamStatus(examId, 'FAILED', {
    finishedAt: failed.finishedAt,
  });
}