import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { config } from '../../shared/config.js';
import { GeneratorMessage } from '../model.js';

const sqsClient = new SQSClient({});

export async function sendGeneratorMessage(message: GeneratorMessage): Promise<void> {
  const validated = GeneratorMessage.parse(message);
  await sqsClient.send(
    new SendMessageCommand({
      QueueUrl: config.generatorQueueUrl,
      MessageBody: JSON.stringify(validated),
    }),
  );
}