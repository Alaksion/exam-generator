import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config.js';
import { FullExam } from '../types.js';

const s3Client = new S3Client({});

export async function getCanonicalExam(s3Key: string): Promise<FullExam> {
  const response = await s3Client.send(
    new GetObjectCommand({
      Bucket: config.artifactsBucket,
      Key: s3Key,
    }),
  );

  const body = await response.Body?.transformToString();
  if (!body) {
    throw new Error('Artifact body is empty');
  }

  return FullExam.parse(JSON.parse(body));
}

export async function getPresignedDownloadUrl(s3Key: string): Promise<{ url: string; expiresAt: string }> {
  const command = new GetObjectCommand({
    Bucket: config.artifactsBucket,
    Key: s3Key,
  });

  const expiresIn = config.presignedUrlExpirationSeconds;
  const url = await getSignedUrl(s3Client, command, { expiresIn });

  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

  return { url, expiresAt };
}
