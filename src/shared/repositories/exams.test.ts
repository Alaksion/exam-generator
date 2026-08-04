import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listExams } from './exams.js';

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
});
