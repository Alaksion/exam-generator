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
  expectedStatus?: ExamStatus,
): Promise<boolean> {
  const expressionParts: string[] = ['#status = :status'];
  const names: Record<string, string> = { '#status': 'status' };
  const values: Record<string, unknown> = { ':status': status };

  for (const [key, value] of Object.entries(updates)) {
    expressionParts.push(`#${key} = :${key}`);
    names[`#${key}`] = key;
    values[`:${key}`] = value;
  }

  let conditionExpression = 'attribute_exists(id)';
  if (expectedStatus) {
    conditionExpression += ' AND #expectedStatus = :expectedStatus';
    names['#expectedStatus'] = 'status';
    values[':expectedStatus'] = expectedStatus;
  }

  try {
    await client.send(
      new UpdateCommand({
        TableName: config.examsTable,
        Key: { id },
        UpdateExpression: `SET ${expressionParts.join(', ')}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ConditionExpression: conditionExpression,
      }),
    );
    return true;
  } catch (error) {
    if ((error as { name?: string }).name === 'ConditionalCheckFailedException') {
      return false;
    }
    throw error;
  }
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
  ownerId?: string;
  limit?: number;
  cursor?: string;
}

function encodeCursor(key: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(key)).toString('base64');
}

function decodeCursor(cursor: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(cursor, 'base64').toString()) as Record<string, unknown>;
}

export async function listExams(filters: ListExamsFilters): Promise<{ exams: Exam[]; nextCursor?: string }> {
  const limit = Math.min(filters.limit ?? 20, 100);
  const status = filters.status ?? 'READY';

  const exams: Exam[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined = filters.cursor ? decodeCursor(filters.cursor) : undefined;

  do {
    // Fetch only as many raw rows as we still need: in-memory filters (status,
    // provider, certificationId) can otherwise over-fetch a page and, once sliced,
    // drop matching rows while the cursor has already advanced past them.
    const remaining = limit - exams.length;

    let result;
    if (filters.ownerId) {
      result = await client.send(
        new QueryCommand({
          TableName: config.examsTable,
          IndexName: 'OwnerCreatedAtIndex',
          KeyConditionExpression: 'ownerId = :ownerId',
          ExpressionAttributeValues: { ':ownerId': filters.ownerId },
          ScanIndexForward: false,
          Limit: remaining,
          ExclusiveStartKey: lastEvaluatedKey,
        }),
      );
    } else if (filters.certificationId) {
      result = await client.send(
        new QueryCommand({
          TableName: config.examsTable,
          IndexName: 'CertificationIdIndex',
          KeyConditionExpression: 'certificationId = :certificationId',
          ExpressionAttributeValues: { ':certificationId': filters.certificationId },
          ScanIndexForward: false,
          Limit: remaining,
          ExclusiveStartKey: lastEvaluatedKey,
        }),
      );
    } else {
      result = await client.send(
        new QueryCommand({
          TableName: config.examsTable,
          IndexName: 'StatusCreatedAtIndex',
          KeyConditionExpression: '#status = :status',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: { ':status': status },
          ScanIndexForward: false,
          Limit: remaining,
          ExclusiveStartKey: lastEvaluatedKey,
        }),
      );
    }

    let page = (result.Items as unknown as Exam[]) ?? [];
    page = page.filter(
      (exam) =>
        exam.status === status &&
        (!filters.provider || exam.provider === filters.provider) &&
        (!filters.certificationId || exam.certificationId === filters.certificationId),
    );
    exams.push(...page);
    lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastEvaluatedKey && exams.length < limit);

  return {
    exams: exams.slice(0, limit),
    nextCursor: lastEvaluatedKey ? encodeCursor(lastEvaluatedKey) : undefined,
  };
}
