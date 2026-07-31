import type { Content } from 'pdfmake';
import pdfmake from 'pdfmake';
import vfs from 'pdfmake/build/vfs_fonts.js';
import { FullExam, Question } from '../types.js';

type DocumentDefinition = Parameters<typeof pdfmake.createPdf>[0];

type VirtualFileSystem = {
  writeFileSync: (path: string, data: Buffer) => void;
};

type PdfMakeInstance = typeof pdfmake & {
  virtualfs: VirtualFileSystem;
};

let fontsInitialized = false;

function getInstance(): PdfMakeInstance {
  return pdfmake as unknown as PdfMakeInstance;
}

function initializeFonts(): void {
  if (fontsInitialized) {
    return;
  }

  const instance = getInstance();
  for (const [filename, base64] of Object.entries(vfs)) {
    if (typeof base64 !== 'string') {
      continue;
    }
    instance.virtualfs.writeFileSync(filename, Buffer.from(base64, 'base64'));
  }

  instance.addFonts({
    Roboto: {
      normal: 'Roboto-Regular.ttf',
      bold: 'Roboto-Medium.ttf',
      italics: 'Roboto-Italic.ttf',
      bolditalics: 'Roboto-MediumItalic.ttf',
    },
  });
  instance.setUrlAccessPolicy(() => false);
  instance.setLocalAccessPolicy(() => false);
  fontsInitialized = true;
}

function renderQuestion(q: Question): Content[] {
  return [
    { text: `Question ${q.number} — ${q.domain} (${q.difficulty})`, style: 'questionTitle' },
    { text: q.text, margin: [0, 0, 0, 8] },
    ...q.options.map((option) => ({
      text: `${option.label}. ${option.text}`,
      style: 'option',
    })),
    { text: '', margin: [0, 0, 0, 10] },
  ];
}

function renderAnswerKey(q: Question): Content[] {
  const correctOption = q.options.find((option) => option.isCorrect);
  if (!correctOption) {
    throw new Error(`Question ${q.number} has no correct option`);
  }

  const entries: Content[] = [
    { text: `Question ${q.number}: ${correctOption.label}`, style: 'questionTitle' },
    { text: `Explanation: ${q.explanation}`, style: 'option' },
  ];

  if (q.reference) {
    entries.push({ text: `Reference: ${q.reference}`, style: 'option' });
  }

  entries.push({ text: '', margin: [0, 0, 0, 8] });
  return entries;
}

function buildDocument(exam: FullExam): DocumentDefinition {
  return {
    content: [
      { text: exam.title, style: 'header' },
      ...exam.questions.flatMap(renderQuestion),
      { text: '', pageBreak: 'before' },
      { text: 'Answer Key', style: 'header', pageBreak: 'before' },
      ...exam.questions.flatMap(renderAnswerKey),
    ],
    styles: {
      header: { fontSize: 18, bold: true, margin: [0, 0, 0, 10] },
      questionTitle: { fontSize: 12, bold: true, margin: [0, 10, 0, 5] },
      option: { fontSize: 11, margin: [0, 2, 0, 2] },
    },
  };
}

export async function renderExamPdf(exam: FullExam): Promise<Buffer> {
  initializeFonts();
  const instance = getInstance();
  const pdf = instance.createPdf(buildDocument(exam));
  return pdf.getBuffer();
}
