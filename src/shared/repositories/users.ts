import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { config } from '../config.js';
import { InvalidRequestError } from '../errors.js';
import { Role, User } from '../types.js';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export interface ListUsersFilters {
  email?: string;
  sub?: string;
  limit?: number;
  cursor?: string;
}

function encodeCursor(key: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(key)).toString('base64');
}

function decodeCursor(cursor: string): Record<string, unknown> {
  try {
    return JSON.parse(Buffer.from(cursor, 'base64').toString()) as Record<string, unknown>;
  } catch {
    throw new InvalidRequestError('The cursor is malformed.');
  }
}

export async function listUsers(
  filters: ListUsersFilters = {},
): Promise<{ users: User[]; nextCursor?: string }> {
  const limit = Math.min(filters.limit ?? 20, 100);
  const lastEvaluatedKey = filters.cursor ? decodeCursor(filters.cursor) : undefined;

  let result;
  if (filters.sub) {
    result = await client.send(
      new QueryCommand({
        TableName: config.usersTable,
        IndexName: 'UserIdIndex',
        KeyConditionExpression: 'userId = :userId',
        ExpressionAttributeValues: { ':userId': filters.sub },
        Limit: limit,
        ExclusiveStartKey: lastEvaluatedKey,
      }),
    );
  } else {
    const scan: {
      TableName: string;
      Limit: number;
      ExclusiveStartKey?: Record<string, unknown>;
      FilterExpression?: string;
      ExpressionAttributeValues?: Record<string, unknown>;
    } = {
      TableName: config.usersTable,
      Limit: limit,
      ExclusiveStartKey: lastEvaluatedKey,
    };
    if (filters.email) {
      scan.FilterExpression = 'contains(email, :email)';
      scan.ExpressionAttributeValues = { ':email': filters.email };
    }
    result = await client.send(new ScanCommand(scan));
  }

  const users = (result.Items as User[]) ?? [];
  return {
    users: users.slice(0, limit),
    nextCursor: result.LastEvaluatedKey ? encodeCursor(result.LastEvaluatedKey) : undefined,
  };
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const result = await client.send(
    new GetCommand({
      TableName: config.usersTable,
      Key: { email: normalizeEmail(email) },
    }),
  );
  return (result.Item as User) ?? null;
}

export async function getUserById(userId: string): Promise<User | null> {
  const result = await client.send(
    new QueryCommand({
      TableName: config.usersTable,
      IndexName: 'UserIdIndex',
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: { ':userId': userId },
      Limit: 1,
    }),
  );
  return (result.Items?.[0] as User) ?? null;
}

export async function createUser(user: User): Promise<'created' | 'exists'> {
  try {
    await client.send(
      new PutCommand({
        TableName: config.usersTable,
        Item: user,
        ConditionExpression: 'attribute_not_exists(email)',
      }),
    );
    return 'created';
  } catch (error) {
    if ((error as { name?: string }).name === 'ConditionalCheckFailedException') {
      return 'exists';
    }
    throw error;
  }
}

export async function updateUserRole(userId: string, role: Role): Promise<User | null> {
  const user = await getUserById(userId);
  if (!user) {
    return null;
  }

  await client.send(
    new UpdateCommand({
      TableName: config.usersTable,
      Key: { email: user.email },
      UpdateExpression: 'SET #role = :role',
      ExpressionAttributeNames: { '#role': 'role' },
      ExpressionAttributeValues: { ':role': role },
      ConditionExpression: 'attribute_exists(email)',
    }),
  );

  return { ...user, role };
}
