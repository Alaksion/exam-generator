import { describe, it, expect } from 'vitest';
import { renderExamPdf } from './pdfRenderer.js';
import { FullExam } from '../types.js';

const exam: FullExam = {
  schemaVersion: '1.0.0',
  id: '11111111-1111-1111-1111-111111111111',
  certificationId: '22222222-2222-2222-2222-222222222222',
  provider: 'aws',
  title: 'Sample Certification Exam',
  status: 'READY',
  createdAt: '2026-07-31T12:00:00.000Z',
  finishedAt: '2026-07-31T12:05:00.000Z',
  s3KeyJson: 'exams/11111111-1111-1111-1111-111111111111/exam.json',
  s3KeyPdf: 'exams/11111111-1111-1111-1111-111111111111/exam.pdf',
  questions: [
    {
      id: '33333333-3333-3333-3333-333333333333',
      number: 1,
      domain: 'Domain A',
      difficulty: 'easy',
      text: 'What is the first question?',
      options: [
        { id: '44444444-4444-4444-4444-444444444444', label: 'A', text: 'First option', isCorrect: true },
        { id: '55555555-5555-5555-5555-555555555555', label: 'B', text: 'Second option', isCorrect: false },
      ],
      explanation: 'Option A is correct because it is the first option.',
      reference: 'https://example.com/ref-1',
    },
    {
      id: '66666666-6666-6666-6666-666666666666',
      number: 2,
      domain: 'Domain B',
      difficulty: 'medium',
      text: 'What is the second question?',
      options: [
        { id: '77777777-7777-7777-7777-777777777777', label: 'A', text: 'Alpha', isCorrect: false },
        { id: '88888888-8888-8888-8888-888888888888', label: 'B', text: 'Beta', isCorrect: true },
        { id: '99999999-9999-9999-9999-999999999999', label: 'C', text: 'Gamma', isCorrect: false },
      ],
      explanation: 'Option B is the correct choice.',
    },
  ],
};

describe('renderExamPdf', () => {
  it('produces a valid, non-empty PDF buffer', async () => {
    const buffer = await renderExamPdf(exam);

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.toString('ascii', 0, 5)).toBe('%PDF-');
  });

  it('renders at least three pages (questions, blank separator, answer key)', async () => {
    const buffer = await renderExamPdf(exam);
    const pageCount = (buffer.toString('latin1').match(/\/Type \/Page/g) || []).length;

    expect(pageCount).toBeGreaterThanOrEqual(3);
  });

  it('throws when a question has no correct option', async () => {
    const invalidExam: FullExam = {
      ...exam,
      questions: [
        {
          ...exam.questions[0],
          options: exam.questions[0].options.map((option) => ({ ...option, isCorrect: false })),
        },
      ],
    };

    await expect(renderExamPdf(invalidExam)).rejects.toThrow('Question 1 has no correct option');
  });
});
