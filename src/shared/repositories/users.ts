import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { config } from '../config.js';
import { User } from '../types.js';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

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