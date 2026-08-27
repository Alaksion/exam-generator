import type { Content } from 'pdfmake';
import pdfmake from 'pdfmake';
import vfs from 'pdfmake/build/vfs_fonts.js';
import type { FullExam, Question } from './model.js';

type DocumentDefinition = Parameters<typeof pdfmake.createPdf>[0];

type VirtualFileSystem = {
  writeFileSync: (path: string, data: Buffer) => void;
};

type PdfMakeInstance = typeof pdfmake & {
  virtualfs: VirtualFileSystem;
};

const pdfMakeInstance = pdfmake as unknown as PdfMakeInstance;

let fontsInitialized = false;

function initializeFonts(): void {
  if (fontsInitialized) {
    return;
  }

  for (const [filename, base64] of Object.entries(vfs)) {
    if (typeof base64 !== 'string') {
      continue;
    }
    pdfMakeInstance.virtualfs.writeFileSync(filename, Buffer.from(base64, 'base64'));
  }

  pdfMakeInstance.addFonts({
    Roboto: {
      normal: 'Roboto-Regular.ttf',
      bold: 'Roboto-Medium.ttf',
      italics: 'Roboto-Italic.ttf',
      bolditalics: 'Roboto-MediumItalic.ttf',
    },
  });
  pdfMakeInstance.setUrlAccessPolicy(() => false);
  pdfMakeInstance.setLocalAccessPolicy(() => false);
  fontsInitialized = true;
}

function renderQuestion(q: Question): Content[] {
  const concept = q.concept ? ` — ${q.concept}` : '';
  return [
    { text: `Question ${q.number} — ${q.domain} (${q.difficulty})${concept}`, style: 'questionTitle' },
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
  const pdf = pdfMakeInstance.createPdf(buildDocument(exam));
  return pdf.getBuffer();
}