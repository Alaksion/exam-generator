export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  region: process.env.AWS_REGION || 'us-east-1',
  bedrockModelDefault: process.env.BEDROCK_MODEL_DEFAULT || 'anthropic.claude-3-haiku-20240307-v1:0',
  certificationsTable: requireEnv('DYNAMODB_CERTIFICATIONS_TABLE'),
  examsTable: requireEnv('DYNAMODB_EXAMS_TABLE'),
  generatorQueueUrl: requireEnv('SQS_GENERATOR_QUEUE_URL'),
  artifactsBucket: requireEnv('S3_ARTIFACTS_BUCKET'),
} as const;
