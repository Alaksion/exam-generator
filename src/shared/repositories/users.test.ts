import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import * as usersRepo from './users.js';
import { User } from '../types.js';

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

vi.mock('@aws-sdk/lib-dynamodb', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aws-sdk/lib-dynamodb')>();
  return {
    ...actual,
    DynamoDBDocumentClient: {
      from: () => ({
        send: sendMock,
      }),
    },
  };
});

const customerUser: User = {
  userId: 'sub-1',
  email: 'alice@example.com',
  role: 'customer',
  createdAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  sendMock.mockReset();
});

describe('normalizeEmail', () => {
  it('trims and lowercases an email', () => {
    expect(usersRepo.normalizeEmail('  Alice@Example.COM  ')).toBe('alice@example.com');
  });
});

describe('getUserByEmail', () => {
  it('gets by the normalized email partition key', async () => {
    sendMock.mockResolvedValue({ Items: [] });

    await usersRepo.getUserByEmail('Alice@Example.com');

    const command = sendMock.mock.calls[0][0] as GetCommand;
    expect(command).toBeInstanceOf(GetCommand);
    expect(command.input).toMatchObject({
      Key: { email: 'alice@example.com' },
    });
  });

  it('returns the matching user or null', async () => {
    sendMock.mockResolvedValueOnce({ Item: customerUser });
    await expect(usersRepo.getUserByEmail('alice@example.com')).resolves.toEqual(customerUser);

    sendMock.mockResolvedValueOnce({});
    await expect(usersRepo.getUserByEmail('bob@example.com')).resolves.toBeNull();
  });
});

describe('getUserById', () => {
  it('queries the UserIdIndex', async () => {
    sendMock.mockResolvedValueOnce({ Items: [customerUser] });
    await expect(usersRepo.getUserById('sub-1')).resolves.toEqual(customerUser);

    const command = sendMock.mock.calls[0][0] as QueryCommand;
    expect(command).toBeInstanceOf(QueryCommand);
    expect(command.input).toMatchObject({
      IndexName: 'UserIdIndex',
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: { ':userId': 'sub-1' },
    });

    sendMock.mockResolvedValueOnce({ Items: [] });
    await expect(usersRepo.getUserById('missing')).resolves.toBeNull();
  });
});

describe('createUser', () => {
  it('puts a user row conditioned on the email not existing', async () => {
    sendMock.mockResolvedValue({});

    const result = await usersRepo.createUser(customerUser);

    expect(result).toBe('created');
    const command = sendMock.mock.calls[0][0] as PutCommand;
    expect(command).toBeInstanceOf(PutCommand);
    expect(command.input).toMatchObject({
      Item: customerUser,
      ConditionExpression: 'attribute_not_exists(email)',
    });
  });

  it('returns exists when the email is already claimed', async () => {
    sendMock.mockRejectedValueOnce({ name: 'ConditionalCheckFailedException' });

    await expect(usersRepo.createUser(customerUser)).resolves.toBe('exists');
  });
});