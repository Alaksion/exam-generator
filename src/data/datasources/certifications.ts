import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { config } from '../../shared/config.js';
import { CertificationRecord } from '../model.js';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export async function getCertificationById(id: string): Promise<CertificationRecord | null> {
  const result = await client.send(
    new GetCommand({
      TableName: config.certificationsTable,
      Key: { id },
    }),
  );
  return (result.Item as CertificationRecord) ?? null;
}

export async function getCertificationByProviderCode(
  provider: string,
  code: string,
): Promise<CertificationRecord | null> {
  const result = await client.send(
    new QueryCommand({
      TableName: config.certificationsTable,
      IndexName: 'ProviderCodeIndex',
      KeyConditionExpression: 'provider = :provider AND code = :code',
      ExpressionAttributeValues: {
        ':provider': provider,
        ':code': code,
      },
      Limit: 1,
    }),
  );
  return (result.Items?.[0] as CertificationRecord) ?? null;
}

export async function listActiveCertifications(): Promise<CertificationRecord[]> {
  const result = await client.send(
    new ScanCommand({
      TableName: config.certificationsTable,
      FilterExpression: 'isActive = :isActive',
      ExpressionAttributeValues: { ':isActive': true },
    }),
  );
  return (result.Items as CertificationRecord[]) ?? [];
}

export async function createCertification(certification: CertificationRecord): Promise<void> {
  await client.send(
    new PutCommand({
      TableName: config.certificationsTable,
      Item: certification,
      ConditionExpression: 'attribute_not_exists(id)',
    }),
  );
}

export async function updateCertification(
  id: string,
  updates: Partial<Omit<CertificationRecord, 'id' | 'provider' | 'code'>>,
): Promise<void> {
  const expressionParts: string[] = [];
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(updates)) {
    expressionParts.push(`#${key} = :${key}`);
    names[`#${key}`] = key;
    values[`:${key}`] = value;
  }

  if (expressionParts.length === 0) return;

  await client.send(
    new UpdateCommand({
      TableName: config.certificationsTable,
      Key: { id },
      UpdateExpression: `SET ${expressionParts.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ConditionExpression: 'attribute_exists(id)',
    }),
  );
}