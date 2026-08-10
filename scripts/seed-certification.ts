import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { certification } from '../src/test/fixtures/certification.js';

async function seedCertifications(): Promise<void> {
  const table = process.env.DYNAMODB_CERTIFICATIONS_TABLE;
  if (!table) {
    throw new Error('DYNAMODB_CERTIFICATIONS_TABLE is required');
  }

  const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

  for (const record of [certification]) {
    await client.send(
      new PutCommand({
        TableName: table,
        Item: record,
      }),
    );
    console.log(
      `Seeded certification ${record.id} (${record.provider}/${record.code}, ${record.name})`,
    );
  }
}

seedCertifications().catch((error) => {
  console.error('Failed to seed certifications', error);
  process.exitCode = 1;
});