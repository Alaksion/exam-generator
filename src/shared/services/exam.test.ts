import { describe, it, expect } from 'vitest';
import { ConflictError } from '../errors.js';
import { createExam, generateExamTitle, transitionExamStatus } from './exam.js';
import { certification } from '../../test/fixtures/certification.js';

describe('generateExamTitle', () => {
  it('formats the title with the certification name and ISO timestamp', () => {
    const now = new Date('2026-07-28T12:00:00.000Z');

    const title = generateExamTitle(certification, now);

    expect(title).toBe('AWS Certified Cloud Practitioner - Practice Exam 2026-07-28T12:00:00.000Z');
  });
});

describe('createExam', () => {
  it('creates an exam in PENDING status with a generated id and title', () => {
    const now = new Date('2026-07-28T12:00:00.000Z');

    const exam = createExam(certification, now);

    expect(exam.certificationId).toBe(certification.id);
    expect(exam.provider).toBe(certification.provider);
    expect(exam.status).toBe('PENDING');
    expect(exam.finishedAt).toBeNull();
    expect(exam.createdAt).toBe(now.toISOString());
    expect(exam.title).toBe(generateExamTitle(certification, now));
    expect(exam.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(exam.s3KeyJson).toBeUndefined();
    expect(exam.s3KeyPdf).toBeUndefined();
  });
});

describe('transitionExamStatus', () => {
  it('claims a PENDING exam to GENERATING without setting finishedAt', () => {
    const now = new Date('2026-07-28T12:00:00.000Z');
    const exam = createExam(certification, now);

    const generating = transitionExamStatus(exam, 'GENERATING', now);

    expect(generating.status).toBe('GENERATING');
    expect(generating.finishedAt).toBeNull();
    expect(generating.id).toBe(exam.id);
  });

  it('transitions a GENERATING exam to READY with a finishedAt timestamp', () => {
    const now = new Date('2026-07-28T12:00:00.000Z');
    const generating = transitionExamStatus(createExam(certification, now), 'GENERATING', now);

    const ready = transitionExamStatus(generating, 'READY', now);

    expect(ready.status).toBe('READY');
    expect(ready.finishedAt).toBe(now.toISOString());
  });

  it('transitions a GENERATING exam to FAILED with a finishedAt timestamp', () => {
    const now = new Date('2026-07-28T12:00:00.000Z');
    const generating = transitionExamStatus(createExam(certification, now), 'GENERATING', now);

    const failed = transitionExamStatus(generating, 'FAILED', now);

    expect(failed.status).toBe('FAILED');
    expect(failed.finishedAt).toBe(now.toISOString());
  });

  it('transitions a PENDING exam to FAILED with a finishedAt timestamp', () => {
    const now = new Date('2026-07-28T12:00:00.000Z');
    const exam = createExam(certification, now);

    const failed = transitionExamStatus(exam, 'FAILED', now);

    expect(failed.status).toBe('FAILED');
    expect(failed.finishedAt).toBe(now.toISOString());
  });

  it('throws when transitioning a PENDING exam directly to READY', () => {
    const now = new Date('2026-07-28T12:00:00.000Z');
    const exam = createExam(certification, now);

    expect(() => transitionExamStatus(exam, 'READY', now)).toThrow(ConflictError);
  });

  it('throws when transitioning from a terminal status', () => {
    const now = new Date('2026-07-28T12:00:00.000Z');
    const ready = transitionExamStatus(
      transitionExamStatus(createExam(certification, now), 'GENERATING', now),
      'READY',
      now,
    );

    expect(() => transitionExamStatus(ready, 'FAILED', now)).toThrow(ConflictError);
  });
});
