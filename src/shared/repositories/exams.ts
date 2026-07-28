import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { config } from '../config.js';
import { Exam, ExamStatus } from '../types.js';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export async function getExamById(id: string): Promise<Exam | null> {
  const result = await client.send(
    new GetCommand({
      TableName: config.examsTable,
      Key: { id },
    }),
  );
  return (result.Item as Exam) ?? null;
}

export async function createExam(exam: Exam): Promise<void> {
  await client.send(
    new PutCommand({
      TableName: config.examsTable,
      Item: exam,
      ConditionExpression: 'attribute_not_exists(id)',
    }),
  );
}

export async function updateExamStatus(
  id: string,
  status: ExamStatus,
  updates: Partial<Omit<Exam, 'id' | 'status'>> = {},
): Promise<void> {
  const expressionParts: string[] = ['#status = :status'];
  const names: Record<string, string> = { '#status': 'status' };
  const values: Record<string, unknown> = { ':status': status };

  for (const [key, value] of Object.entries(updates)) {
    expressionParts.push(`#${key} = :${key}`);
    names[`#${key}`] = key;
    values[`:${key}`] = value;
  }

  await client.send(
    new UpdateCommand({
      TableName: config.examsTable,
      Key: { id },
      UpdateExpression: `SET ${expressionParts.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ConditionExpression: 'attribute_exists(id)',
    }),
  );
}

export async function deleteExam(id: string): Promise<void> {
  await client.send(
    new DeleteCommand({
      TableName: config.examsTable,
      Key: { id },
    }),
  );
}

export interface ListExamsFilters {
  status?: ExamStatus;
  provider?: string;
  certificationId?: string;
  limit?: number;
  cursor?: string;
}

export async function listExams(filters: ListExamsFilters): Promise<{ exams: Exam[]; nextCursor?: string }> {
  const limit = Math.min(filters.limit ?? 20, 100);

  // Use the status index when no certification filter is requested.
  if (!filters.certificationId) {
    const result = await client.send(
      new QueryCommand({
        TableName: config.examsTable,
        IndexName: 'StatusCreatedAtIndex',
        KeyConditionExpression: '#status = :status',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':status': filters.status ?? 'READY' },
        ScanIndexForward: false,
        Limit: limit,
        ExclusiveStartKey: filters.cursor
          ? (JSON.parse(Buffer.from(filters.cursor, 'base64').toString()) as Record<string, unknown>)
          : undefined,
      }),
    );

    let exams = (result.Items as unknown as Exam[]) ?? [];
    if (filters.provider) {
      exams = exams.filter((exam) => exam.provider === filters.provider);
    }

    return {
      exams,
      nextCursor: result.LastEvaluatedKey
        ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
        : undefined,
    };
  }

  // Otherwise query by certificationId and filter in memory.
  const result = await client.send(
    new QueryCommand({
      TableName: config.examsTable,
      IndexName: 'CertificationIdIndex',
      KeyConditionExpression: 'certificationId = :certificationId',
      ExpressionAttributeValues: { ':certificationId': filters.certificationId },
      ScanIndexForward: false,
      Limit: limit,
        ExclusiveStartKey: filters.cursor
          ? (JSON.parse(Buffer.from(filters.cursor, 'base64').toString()) as Record<string, unknown>)
          : undefined,
    }),
  );

  let exams = (result.Items as unknown as Exam[]) ?? [];
  if (filters.status) {
    exams = exams.filter((exam) => exam.status === filters.status);
  }
  if (filters.provider) {
    exams = exams.filter((exam) => exam.provider === filters.provider);
  }

  return {
    exams,
    nextCursor: result.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
      : undefined,
  };
}
