export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function getIntEnv(name: string, defaultValue: number): number {
  const value = process.env[name];
  if (!value) {
    return defaultValue;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`Invalid integer environment variable: ${name}`);
  }
  return parsed;
}

export const config = {
  region: process.env.AWS_REGION || 'us-east-1',
  bedrockModelDefault: process.env.BEDROCK_MODEL_DEFAULT || 'amazon.nova-lite-v1:0',
  certificationsTable: requireEnv('DYNAMODB_CERTIFICATIONS_TABLE'),
  examsTable: requireEnv('DYNAMODB_EXAMS_TABLE'),
  usersTable: requireEnv('DYNAMODB_USERS_TABLE'),
  generatorQueueUrl: requireEnv('SQS_GENERATOR_QUEUE_URL'),
  artifactsBucket: requireEnv('S3_ARTIFACTS_BUCKET'),
  bedrockMaxAttempts: getIntEnv('BEDROCK_MAX_ATTEMPTS', 3),
  bedrockConcurrency: getIntEnv('BEDROCK_CONCURRENCY', 5),
  presignedUrlExpirationSeconds: getIntEnv('PRESIGNED_URL_EXPIRATION_SECONDS', 300),
} as const;
