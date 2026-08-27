import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import * as usersRepo from './users.js';
import { UserRecord } from '../model.js';
import { InvalidCursorError } from '../errors.js';

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

const customerUser: UserRecord = {
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

describe('listUsers', () => {
  it('queries the UserIdIndex for a sub search', async () => {
    sendMock.mockResolvedValueOnce({ Items: [customerUser] });

    const result = await usersRepo.listUsers({ sub: 'sub-1' });

    expect(result.users).toEqual([customerUser]);
    expect(result.nextCursor).toBeUndefined();
    const command = sendMock.mock.calls[0][0] as QueryCommand;
    expect(command).toBeInstanceOf(QueryCommand);
    expect(command.input).toMatchObject({
      IndexName: 'UserIdIndex',
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: { ':userId': 'sub-1' },
    });
  });

  it('scans with a contains filter on email', async () => {
    sendMock.mockResolvedValueOnce({ Items: [customerUser] });

    const result = await usersRepo.listUsers({ email: 'ali' });

    expect(result.users).toEqual([customerUser]);
    const command = sendMock.mock.calls[0][0] as ScanCommand;
    expect(command).toBeInstanceOf(ScanCommand);
    expect(command.input).toMatchObject({
      FilterExpression: 'contains(email, :email)',
      ExpressionAttributeValues: { ':email': 'ali' },
    });
  });

  it('scans all users when no search term is given', async () => {
    sendMock.mockResolvedValueOnce({ Items: [customerUser] });

    const result = await usersRepo.listUsers({});

    expect(result.users).toEqual([customerUser]);
    const command = sendMock.mock.calls[0][0] as ScanCommand;
    expect(command).toBeInstanceOf(ScanCommand);
    expect(command.input).not.toHaveProperty('FilterExpression');
  });

  it('returns a cursor and resumes from it', async () => {
    sendMock
      .mockResolvedValueOnce({
        Items: [customerUser],
        LastEvaluatedKey: { email: customerUser.email },
      })
      .mockResolvedValueOnce({ Items: [] });

    const first = await usersRepo.listUsers({});
    expect(first.nextCursor).toBeDefined();

    const second = await usersRepo.listUsers({ cursor: first.nextCursor });
    expect(second.users).toEqual([]);
    const command = sendMock.mock.calls[1][0] as ScanCommand;
    expect(command.input.ExclusiveStartKey).toEqual({ email: customerUser.email });
  });

  it('rejects a malformed cursor', async () => {
    await expect(usersRepo.listUsers({ cursor: '%%%not-base64-json%%%' })).rejects.toThrow(
      InvalidCursorError,
    );
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe('updateUserRole', () => {
  it('updates the role by email key and returns the updated user', async () => {
    sendMock.mockResolvedValueOnce({ Items: [customerUser] });
    sendMock.mockResolvedValueOnce({});

    const result = await usersRepo.updateUserRole('sub-1', 'admin');

    expect(result).toEqual({ ...customerUser, role: 'admin' });
    const command = sendMock.mock.calls[1][0] as UpdateCommand;
    expect(command).toBeInstanceOf(UpdateCommand);
    expect(command.input).toMatchObject({
      Key: { email: customerUser.email },
      UpdateExpression: 'SET #role = :role',
      ExpressionAttributeValues: { ':role': 'admin' },
      ConditionExpression: 'attribute_exists(email)',
    });
  });

  it('returns null when no user has the userId', async () => {
    sendMock.mockResolvedValueOnce({ Items: [] });

    await expect(usersRepo.updateUserRole('missing', 'admin')).resolves.toBeNull();
    expect(sendMock).toHaveBeenCalledTimes(1);
  });
});
