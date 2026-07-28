import { SQSHandler, SQSRecord } from 'aws-lambda';
import { GeneratorMessage } from '../shared/types.js';

export const handler: SQSHandler = async (event) => {
  for (const record of event.Records) {
    await processRecord(record);
  }
};

async function processRecord(record: SQSRecord): Promise<void> {
  const payload = JSON.parse(record.body) as unknown;
  const message = GeneratorMessage.parse(payload);

  console.log('Processing generation request', {
    examId: message.examId,
    certificationId: message.certificationId,
    correlationId: message.correlationId,
  });

  // TODO: load certification, call Bedrock per question, render PDF, upload to S3, mark exam READY.
}
