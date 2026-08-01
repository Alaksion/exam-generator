import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import {
  deleteArtifact,
  deleteArtifacts,
  getCanonicalExam,
  getPresignedDownloadUrl,
} from './artifacts.js';

const mockSend = vi.hoisted(() => vi.fn());
const mockGetSignedUrl = vi.hoisted<Mock<[unknown, unknown, unknown], Promise<string>>>(() =>
  vi.fn(),
);

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(() => ({ send: mockSend })),
  GetObjectCommand: vi.fn((input: unknown) => input),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn((client: unknown, command: unknown, options: unknown) =>
    mockGetSignedUrl(client, command, options),
  ) as (client: unknown, command: unknown, options: unknown) => Promise<string>,

  DeleteObjectCommand: vi.fn((input: unknown) => input),
}));

const fullExam = {
  schemaVersion: '1.0.0',
  id: '22222222-2222-2222-2222-222222222222',
  certificationId: '11111111-1111-1111-1111-111111111111',
  provider: 'aws',
  title: 'AWS Certified Cloud Practitioner - Practice Exam',
  status: 'READY',
  createdAt: '2026-07-31T12:00:00.000Z',
  finishedAt: '2026-07-31T12:05:00.000Z',
  questions: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockSend.mockReset();
  mockGetSignedUrl.mockReset();
});

describe('getCanonicalExam', () => {
  it('fetches and parses the canonical exam JSON from S3', async () => {
    mockSend.mockResolvedValue({
      Body: {
        transformToString: vi.fn().mockResolvedValue(JSON.stringify(fullExam)),
      },
    });

    const result = await getCanonicalExam('exams/22222222-2222-2222-2222-222222222222/exam.json');

    expect(result).toEqual(fullExam);
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        Bucket: 'test-artifacts-bucket',
        Key: 'exams/22222222-2222-2222-2222-222222222222/exam.json',
      }),
    );
  });

  it('throws when the artifact body is empty', async () => {
    mockSend.mockResolvedValue({ Body: { transformToString: vi.fn().mockResolvedValue('') } });

    await expect(
      getCanonicalExam('exams/22222222-2222-2222-2222-222222222222/exam.json'),
    ).rejects.toThrow('Artifact body is empty');
  });
});

describe('getPresignedDownloadUrl', () => {
  it('returns a presigned URL and expiration timestamp', async () => {
    const signedUrl = 'https://s3.example.com/presigned.pdf';
    mockGetSignedUrl.mockResolvedValue(signedUrl);

    const before = Date.now();
    const result = await getPresignedDownloadUrl(
      'exams/22222222-2222-2222-2222-222222222222/exam.pdf',
    );
    const after = Date.now();

    expect(result.url).toBe(signedUrl);
    const expiresAtMs = new Date(result.expiresAt).getTime();
    expect(expiresAtMs).toBeGreaterThanOrEqual(before + 300 * 1000);
    expect(expiresAtMs).toBeLessThanOrEqual(after + 300 * 1000 + 1000);

    expect(mockGetSignedUrl).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        Bucket: 'test-artifacts-bucket',
        Key: 'exams/22222222-2222-2222-2222-222222222222/exam.pdf',
      }),
      { expiresIn: 300 },
    );
  });
});

describe('deleteArtifact', () => {
  it('deletes a single S3 object', async () => {
    mockSend.mockResolvedValue({});

    await deleteArtifact('exams/22222222-2222-2222-2222-222222222222/exam.json');

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        Bucket: 'test-artifacts-bucket',
        Key: 'exams/22222222-2222-2222-2222-222222222222/exam.json',
      }),
    );
  });
});

describe('deleteArtifacts', () => {
  it('deletes multiple S3 objects in parallel', async () => {
    mockSend.mockResolvedValue({});

    await deleteArtifacts([
      'exams/22222222-2222-2222-2222-222222222222/exam.json',
      'exams/22222222-2222-2222-2222-222222222222/exam.pdf',
    ]);

    expect(mockSend).toHaveBeenCalledTimes(2);
  });
});
