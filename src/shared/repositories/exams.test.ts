import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listExams, updateExamStatus } from './exams.js';

const mockClient = vi.hoisted(() => ({
  send: vi.fn(),
}));

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: class {},
}));

vi.mock('@aws-sdk/lib-dynamodb', () => {
  class MockCommand {
    constructor(input: unknown) {
      Object.assign(this, input);
    }
  }
  return {
    DynamoDBDocumentClient: {
      from: vi.fn(() => mockClient),
    },
    GetCommand: MockCommand,
    PutCommand: MockCommand,
    QueryCommand: MockCommand,
    UpdateCommand: MockCommand,
    DeleteCommand: MockCommand,
  };
});

const examBase = {
  certificationId: '11111111-1111-1111-1111-111111111111',
  ownerId: 'sub-alice',
  provider: 'aws',
  title: 'AWS Certified Cloud Practitioner - Practice Exam',
  createdAt: '2026-07-31T12:00:00.000Z',
  finishedAt: '2026-07-31T12:05:00.000Z',
};

function readyExam(id: string) {
  return { id, status: 'READY' as const, s3KeyJson: `exams/${id}/exam.json`, s3KeyPdf: `exams/${id}/exam.pdf`, ...examBase };
}

function generatingExam(id: string) {
  return { id, status: 'GENERATING' as const, s3KeyJson: undefined, s3KeyPdf: undefined, ...examBase, finishedAt: null };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockClient.send.mockReset();
});

describe('listExams', () => {
  it('defaults to READY and queries the status index', async () => {
    mockClient.send.mockResolvedValue({ Items: [readyExam('1')] });

    const result = await listExams({});

    expect(result.exams).toHaveLength(1);
    expect(result.exams[0].status).toBe('READY');
    expect(result.nextCursor).toBeUndefined();

    const queryInput = mockClient.send.mock.calls[0][0] as {
      IndexName: string;
      ExpressionAttributeValues: Record<string, unknown>;
    };
    expect(queryInput.IndexName).toBe('StatusCreatedAtIndex');
    expect(queryInput.ExpressionAttributeValues[':status']).toBe('READY');
  });

  it('filters by provider in memory on the status index', async () => {
    mockClient.send.mockResolvedValue({
      Items: [readyExam('1'), { ...readyExam('2'), provider: 'azure' }],
    });

    const result = await listExams({ provider: 'aws' });

    expect(result.exams).toHaveLength(1);
    expect(result.exams[0].provider).toBe('aws');
  });

  it('queries the certification index and applies the default READY status filter', async () => {
    mockClient.send.mockResolvedValue({
      Items: [readyExam('1'), generatingExam('2')],
    });

    const result = await listExams({ certificationId: examBase.certificationId });

    expect(result.exams).toHaveLength(1);
    expect(result.exams[0].status).toBe('READY');

    const queryInput = mockClient.send.mock.calls[0][0] as {
      IndexName: string;
      ExpressionAttributeValues: Record<string, unknown>;
    };
    expect(queryInput.IndexName).toBe('CertificationIdIndex');
    expect(queryInput.ExpressionAttributeValues[':certificationId']).toBe(examBase.certificationId);
  });

  it('queries the owner index for an owner-scoped list', async () => {
    mockClient.send.mockResolvedValue({
      Items: [readyExam('1'), generatingExam('2')],
    });

    const result = await listExams({ ownerId: 'sub-alice' });

    expect(result.exams).toHaveLength(1);
    expect(result.exams[0].ownerId).toBe('sub-alice');

    const queryInput = mockClient.send.mock.calls[0][0] as {
      IndexName: string;
      ExpressionAttributeValues: Record<string, unknown>;
    };
    expect(queryInput.IndexName).toBe('OwnerCreatedAtIndex');
    expect(queryInput.ExpressionAttributeValues[':ownerId']).toBe('sub-alice');
  });

  it('filters an owner-scoped list by certificationId in memory', async () => {
    mockClient.send.mockResolvedValue({
      Items: [
        readyExam('1'),
        { ...readyExam('2'), certificationId: '99999999-9999-9999-9999-999999999999' },
      ],
    });

    const result = await listExams({
      ownerId: 'sub-alice',
      certificationId: examBase.certificationId,
    });

    expect(result.exams).toHaveLength(1);
    expect(result.exams[0].id).toBe('1');
  });

  it('paginates until the requested limit is reached and returns the last cursor', async () => {
    mockClient.send
      .mockResolvedValueOnce({
        Items: [readyExam('1')],
        LastEvaluatedKey: { id: '1', status: 'READY', createdAt: '2026-07-31T12:00:00.000Z' },
      })
      .mockResolvedValueOnce({
        Items: [readyExam('2')],
        LastEvaluatedKey: { id: '2', status: 'READY', createdAt: '2026-07-31T12:01:00.000Z' },
      });

    const result = await listExams({ limit: 2 });

    expect(result.exams).toHaveLength(2);
    expect(result.nextCursor).toBeDefined();
    expect(mockClient.send).toHaveBeenCalledTimes(2);
  });

  it('stops paginating when no more pages exist', async () => {
    mockClient.send.mockResolvedValueOnce({ Items: [readyExam('1')] });

    const result = await listExams({ limit: 10 });

    expect(result.exams).toHaveLength(1);
    expect(result.nextCursor).toBeUndefined();
    expect(mockClient.send).toHaveBeenCalledTimes(1);
  });

  it('resumes from a cursor', async () => {
    const cursor = Buffer.from(
      JSON.stringify({ id: 'prev', status: 'READY', createdAt: '2026-07-31T12:00:00.000Z' }),
    ).toString('base64');
    mockClient.send.mockResolvedValueOnce({ Items: [readyExam('next')] });

    await listExams({ cursor });

    const queryInput = mockClient.send.mock.calls[0][0] as { ExclusiveStartKey: Record<string, string> };
    expect(queryInput.ExclusiveStartKey.id).toBe('prev');
  });

  it('does not drop matching exams when an in-memory filter page would overshoot the limit', async () => {
    const pagedKey = (marker: string) =>
      ({ id: marker, ownerId: 'sub-alice', createdAt: examBase.createdAt });

    mockClient.send
      .mockResolvedValueOnce({
        Items: [readyExam('1'), generatingExam('2')],
        LastEvaluatedKey: pagedKey('1'),
      })
      .mockResolvedValueOnce({
        Items: [readyExam('3'), readyExam('4'), readyExam('5')],
        LastEvaluatedKey: pagedKey('3'),
      });

    const result = await listExams({ limit: 3, ownerId: 'sub-alice' });

    // One READY row on page one (the other is GENERATING and filtered out), so the
    // second page fetch must be capped at the two that remain — it must not over-read
    // a full page and strand matching rows behind the cursor.
    expect(result.exams).toHaveLength(3);
    expect(result.nextCursor).toBeDefined();
    const secondPage = mockClient.send.mock.calls[1][0] as { Limit: number };
    expect(secondPage.Limit).toBe(2);
  });
});

describe('updateExamStatus', () => {
  it('returns true and adds the expected-status condition when none fails', async () => {
    mockClient.send.mockResolvedValue({});

    const result = await updateExamStatus('1', 'GENERATING', {}, 'PENDING');

    expect(result).toBe(true);
    const cmd = mockClient.send.mock.calls[0][0] as {
      ConditionExpression: string;
      ExpressionAttributeValues: Record<string, unknown>;
    };
    expect(cmd.ConditionExpression).toContain('attribute_exists(id)');
    expect(cmd.ConditionExpression).toContain('#expectedStatus = :expectedStatus');
    expect(cmd.ExpressionAttributeValues[':expectedStatus']).toBe('PENDING');
  });

  it('returns false when the expected-status condition fails', async () => {
    const conditionalError = Object.assign(new Error('The conditional request failed'), {
      name: 'ConditionalCheckFailedException',
    });
    mockClient.send.mockRejectedValue(conditionalError);

    const result = await updateExamStatus('1', 'GENERATING', {}, 'PENDING');

    expect(result).toBe(false);
  });

  it('returns true without an expected-status condition when none is provided', async () => {
    mockClient.send.mockResolvedValue({});

    const result = await updateExamStatus('1', 'READY', { finishedAt: '2026-07-31T12:05:00.000Z' });

    expect(result).toBe(true);
    const cmd = mockClient.send.mock.calls[0][0] as { ConditionExpression: string };
    expect(cmd.ConditionExpression).toBe('attribute_exists(id)');
  });

  it('rethrows non-conditional errors', async () => {
    mockClient.send.mockRejectedValue(new Error('boom'));

    await expect(updateExamStatus('1', 'GENERATING', {}, 'PENDING')).rejects.toThrow('boom');
  });
});
