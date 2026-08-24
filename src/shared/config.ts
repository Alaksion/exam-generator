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

export type SignupMode = 'open' | 'invite';

export interface Config {
  region: string;
  bedrockModelDefault: string;
  certificationsTable: string;
  examsTable: string;
  usersTable: string;
  cognitoUserPoolClientId: string;
  generatorQueueUrl: string;
  artifactsBucket: string;
  bedrockMaxAttempts: number;
  bedrockConcurrency: number;
  presignedUrlExpirationSeconds: number;
  signupMode: SignupMode;
  betaAllowlist: Set<string>;
  examGenerationV2: boolean;
}

// Env vars are resolved lazily so a function only fails on the variables it
// actually reads. This lets the Cognito trigger functions run without the
// API-only User Pool client id, avoiding a circular template dependency.
export const config: Config = {
  get region() {
    return process.env.AWS_REGION || 'us-east-1';
  },
  get bedrockModelDefault() {
    return process.env.BEDROCK_MODEL_DEFAULT || 'amazon.nova-lite-v1:0';
  },
  get certificationsTable() {
    return requireEnv('DYNAMODB_CERTIFICATIONS_TABLE');
  },
  get examsTable() {
    return requireEnv('DYNAMODB_EXAMS_TABLE');
  },
  get usersTable() {
    return requireEnv('DYNAMODB_USERS_TABLE');
  },
  get cognitoUserPoolClientId() {
    return requireEnv('COGNITO_USER_POOL_CLIENT_ID');
  },
  get generatorQueueUrl() {
    return requireEnv('SQS_GENERATOR_QUEUE_URL');
  },
  get artifactsBucket() {
    return requireEnv('S3_ARTIFACTS_BUCKET');
  },
  get bedrockMaxAttempts() {
    return getIntEnv('BEDROCK_MAX_ATTEMPTS', 3);
  },
  get bedrockConcurrency() {
    return getIntEnv('BEDROCK_CONCURRENCY', 5);
  },
  get presignedUrlExpirationSeconds() {
    return getIntEnv('PRESIGNED_URL_EXPIRATION_SECONDS', 300);
  },
  get signupMode() {
    return process.env.SIGNUP_MODE === 'invite' ? 'invite' : 'open';
  },
  get betaAllowlist() {
    return new Set(
      (process.env.BETA_ALLOWLIST || '')
        .split(',')
        .map((entry) => entry.trim().toLowerCase())
        .filter((entry) => entry.length > 0),
    );
  },
  get examGenerationV2() {
    return process.env.EXAM_GENERATION_V2 === 'true';
  },
};
