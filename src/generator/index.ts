import { SQSRecord, SQSEvent } from 'aws-lambda';
import { GeneratorMessage } from '../data/model.js';
import {
  processGenerationMessage,
  buildArtifactKeys,
  CANONICAL_EXAM_SCHEMA_VERSION,
  CANONICAL_EXAM_SCHEMA_VERSION_V2,
} from '../services/generationService.js';

export const handler = async (event: SQSEvent): Promise<void> => {
  for (const record of event.Records) {
    await processRecord(record);
  }
};

async function processRecord(record: SQSRecord): Promise<void> {
  console.info('Processing record', { messageId: record.messageId, body: record.body });
  const payload = JSON.parse(record.body) as unknown;
  const message = GeneratorMessage.parse(payload);
  await processGenerationMessage(message);
}

export { buildArtifactKeys, CANONICAL_EXAM_SCHEMA_VERSION, CANONICAL_EXAM_SCHEMA_VERSION_V2 };