import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
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
  it('queries the EmailIndex with a normalized email', async () => {
    sendMock.mockResolvedValue({ Items: [] });

    await usersRepo.getUserByEmail('Alice@Example.com');

    const command = sendMock.mock.calls[0][0] as QueryCommand;
    expect(command).toBeInstanceOf(QueryCommand);
    expect(command.input).toMatchObject({
      IndexName: 'EmailIndex',
      KeyConditionExpression: 'email = :email',
      ExpressionAttributeValues: { ':email': 'alice@example.com' },
    });
  });

  it('returns the matching user or null', async () => {
    const user = customerUser;
    sendMock.mockResolvedValueOnce({ Items: [user] });
    await expect(usersRepo.getUserByEmail('alice@example.com')).resolves.toEqual(user);

    sendMock.mockResolvedValueOnce({ Items: [] });
    await expect(usersRepo.getUserByEmail('bob@example.com')).resolves.toBeNull();
  });
});

describe('createUser', () => {
  it('puts a user row with a condition by default', async () => {
    sendMock.mockResolvedValue({});

    const user = customerUser;
    const result = await usersRepo.createUser(user);

    expect(result).toBe('created');
    const command = sendMock.mock.calls[0][0] as PutCommand;
    expect(command).toBeInstanceOf(PutCommand);
    expect(command.input).toMatchObject({
      Item: user,
      ConditionExpression: 'attribute_not_exists(userId)',
    });
  });

  it('returns exists when the conditional put fails', async () => {
    sendMock.mockResolvedValueOnce({}).mockRejectedValueOnce({ name: 'ConditionalCheckFailedException' });

    const user = customerUser;
    await expect(usersRepo.createUser(user)).resolves.toBe('created');
    await expect(usersRepo.createUser(user)).resolves.toBe('exists');
  });
});

describe('getUserById', () => {
  it('gets a user by id', async () => {
    const user = customerUser;
    sendMock.mockResolvedValueOnce({ Item: user });
    await expect(usersRepo.getUserById('sub-1')).resolves.toEqual(user);

    sendMock.mockResolvedValueOnce({});
    await expect(usersRepo.getUserById('missing')).resolves.toBeNull();
  });
});