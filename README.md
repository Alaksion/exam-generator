# exam-generator

Serverless backend for a mock-exam generator. It exposes a public REST API and an asynchronous worker that creates practice exams for IT certifications (AWS, Azure, GCP) using Amazon Bedrock.

The architecture is described in [`CONTEXT.md`](./CONTEXT.md) and [`docs/adr/0001-domain-model-and-aws-mvp-architecture.md`](./docs/adr/0001-domain-model-and-aws-mvp-architecture.md).

## Architecture overview

```
┌──────────────┐   Cognito JWT  ┌──────────────┐
│ API Gateway  │ ─────────────▶ │  API Lambda  │
└──────────────┘  Authorization └──────────────┘
                                              │
                                              ▼
                            ┌─────────────────┼─────────────────┐
                            ▼                 ▼                 ▼
                    ┌───────────────┐ ┌───────────────┐ ┌───────────────┐
                    │  Users (role) │ │Certifications │ │    Exams      │
                    │   DynamoDB    │ │   DynamoDB    │ │   DynamoDB    │
                    └───────────────┘ └───────────────┘ └───────┬───────┘
                                                               │
                                              ▼ SQS            │
                                    ┌──────────────────┐       │
                                    │ Generator Lambda │ ──▶ Bedrock
                                    └──────────────────┘       │
                                                               ▼
                                                         S3 Artifacts
```

## Tech stack

- **AWS SAM** — infrastructure as code and local emulation
- **TypeScript / Node.js 22** — Lambda runtime
- **Amazon Cognito** — user pools, JWT auth, and Google/Apple federated sign-in
- **API Gateway (HTTP API)** — public endpoints with a Cognito User Pools authorizer
- **DynamoDB** — users, certifications, and exams metadata
- **S3** — canonical JSON and generated PDF artifacts
- **SQS** — asynchronous generation queue
- **Amazon Bedrock** — LLM question generation

## Prerequisites

- [Node.js 22](https://nodejs.org/) (see `.nvmrc`)
- [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html)
- [AWS CLI](https://aws.amazon.com/cli/) configured with credentials
- `make` (optional, used for convenience commands)

## Getting started

### 1. Install dependencies

```bash
npm install
# or
make install
```

### 2. Configure deployment settings

Copy the example SAM config and adjust values for your account/region:

```bash
cp samconfig.example.toml samconfig.toml
```

Deploy with SAM; the stack prompts for any required parameters (auth callback
URLs, federated IdP credentials, etc.):

```bash
make deploy
```

For CI/CD, pass parameters via environment/parameter overrides instead of
committing them:

```bash
sam deploy --parameter-overrides \
  AuthCallbackUrl=$AUTH_CALLBACK_URL \
  GoogleClientId=$GOOGLE_CLIENT_ID \
  GoogleClientSecret=$GOOGLE_CLIENT_SECRET
```

### 3. Build the project

```bash
npm run build
# or
make build
```

SAM uses `esbuild` to bundle TypeScript source files into each Lambda function.

### 4. Run locally

Start the API on `http://localhost:3000`:

```bash
npm start
# or
make start
```

Invoke the generator Lambda manually with a synthetic SQS message:

```bash
npm run start:generate
# or
make start-generate
```

Local emulation uses your AWS credentials for DynamoDB/S3/SQS/Bedrock, so create the stack in a dev account first or use [LocalStack](https://localstack.cloud/) if you prefer fully local resources.

### 5. Deploy to AWS

```bash
make deploy
```

This creates:

- An API Gateway with CORS and a Cognito User Pools authorizer
- A Cognito user pool with email/password auth, Google/Apple federated sign-in, and email-lock + user-provisioning triggers
- Three Lambda functions: API handler, login trigger, and generator worker
- Three DynamoDB tables: `users`, `certifications`, and `exams` with GSIs
- An SQS queue with a dead-letter queue for generation jobs
- An S3 bucket for exam JSON and PDF artifacts

### 6. Authenticate with the API

All endpoints except `GET /v1/health` and `POST /v1/auth/forgot-password` require a
Cognito ID token sent as a `Bearer` token:

```bash
curl -H "Authorization: Bearer $COGNITO_ID_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"certificationId":"cert-uuid"}' \
     "${API_URL}/v1/exams"
```

#### Auth flows

The client app drives these flows directly against Cognito (see ADR-0004):

- **Sign up (email/password)** — `SignUp`, then `ConfirmSignUp` with the emailed code. Email must be verified before first login.
- **Log in** — `InitiateAuth` with `USER_SRP_AUTH`; refresh via `REFRESH_TOKEN_AUTH`.
- **Password reset** — `POST /v1/auth/forgot-password` (proxied, enumeration-constant), then `ConfirmForgotPassword` directly against Cognito.
- **Social sign-in** — the client redirects through the Hosted UI OAuth leg (`/oauth2/authorize` → Google/Apple → callback); the Hosted UI domain is printed as the `AuthDomain` stack output. First social sign-in provisions a verified `customer` account; subsequent sign-ins succeed. The email lock is symmetric — whichever path (email/password, Google, or Apple) claims an email first owns it, and later attempts from any path are rejected with a generic error.

The `UserPoolId` and `UserPoolClientId` stack outputs configure the client SDK. `GET /v1/me` returns the caller's `{ sub, email, role, createdAt }` and doubles as a session-liveness check.

### 7. Seed the certification catalog

The catalog needs at least one Certification before exams can be generated. Seed the AWS Cloud
Practitioner record (the seed data lives in `src/test/fixtures/certification.ts`):

```bash
export DYNAMODB_CERTIFICATIONS_TABLE=$(aws cloudformation describe-stacks --stack-name exam-generator \
  --query "Stacks[0].Outputs[?OutputKey=='CertificationsTableName'].OutputValue" --output text)
npm run seed:certifications
```

Re-running is safe and idempotent — the record uses stable ids and is overwritten.

### 8. Bootstrap the first admin

Roles are read from the `Users` table on every request. The first admin is created
outside the API by pointing the script at the stack's users table and passing the
target's Cognito `sub` or email:

```bash
export DYNAMODB_USERS_TABLE=$(aws cloudformation describe-stacks --stack-name exam-generator \
  --query "Stacks[0].Outputs[?OutputKey=='UsersTableName'].OutputValue" --output text)
npm run promote:admin -- <sub-or-email>
```

The script sets the matching user's role to `admin` directly in the table. Re-running is
idempotent. Ongoing promotion/demotion goes through `PUT /v1/admin/users/{id}/role`
(admin-only).

## Project layout

```
.
├── template.yaml              # SAM infrastructure template
├── samconfig.example.toml     # Example SAM deployment config (do not commit secrets)
├── tsconfig.json              # TypeScript configuration
├── package.json               # Node.js dependencies and scripts
├── Makefile                   # Common build/run/deploy commands
├── src/
│   ├── api/                   # API Gateway Lambda handler
│   │   └── index.ts           # HTTP router and endpoint handlers
│   ├── authTriggers/          # Cognito email-lock + user-provisioning triggers
│   │   └── index.ts
│   ├── generator/             # SQS worker Lambda
│   │   └── index.ts
│   └── shared/                # Shared code
│       ├── types.ts           # Domain types and Zod schemas
│       ├── errors.ts          # API error vocabulary
│       ├── config.ts          # Environment-driven configuration
│       ├── router.ts          # Minimal HTTP router for API Gateway
│       └── repositories/      # DynamoDB data access
├── docs/                      # Architecture and agent documentation
└── CONTEXT.md                 # Domain context and glossary
```

## Scripts

| Command | Description |
| --- | --- |
| `npm run build` | Build Lambda artifacts with SAM |
| `npm start` | Start the local API Gateway emulator |
| `npm run start:generate` | Invoke the generator Lambda locally |
| `npm test` | Run the test suite with Vitest |
| `npm run lint` | Type-check and lint with TypeScript + ESLint |
| `npm run format` | Format source files with Prettier |
| `npm run deploy` | Deploy interactively with SAM |
| `npm run deploy:ci` | Deploy non-interactively (for CI/CD) |
| `npm run seed:certifications` | Seed the certification catalog |
| `npm run promote:admin -- <sub-or-email>` | Promote a user to admin in the `Users` table |

## API endpoints

**Public (no auth)**

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/v1/health` | Health probe (unauthenticated so infra checks can reach it) |
| `POST` | `/v1/auth/forgot-password` | Proxy Cognito `ForgotPassword`; enumeration-constant |

**Any authenticated user (`customer` or `admin`)**

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/v1/me` | The caller's `{ sub, email, role, createdAt }` |
| `GET` | `/v1/certifications` | List active certifications |
| `GET` | `/v1/certifications/{id}` | Get a certification |
| `POST` | `/v1/exams` | Request a new exam generation (owned by the caller) |
| `GET` | `/v1/exams` | List the caller's own exams (with filters/pagination) |
| `GET` | `/v1/exams/{id}` | Get full exam detail (own/exam-owned) |
| `GET` | `/v1/exams/{id}/status` | Poll generation status |
| `GET` | `/v1/exams/{id}/download` | Presigned PDF download |
| `DELETE` | `/v1/exams/{id}` | Delete an exam and its artifacts |

**Admin-only**

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/v1/admin/users` | Search + paginate users |
| `PUT` | `/v1/admin/users/{id}/role` | Promote/demote a user's role |
| `POST` | `/v1/admin/certifications` | Create a certification |
| `PUT` | `/v1/admin/certifications/{id}` | Update certification metadata |
| `GET` | `/v1/admin/exams` | List any user's exams |
| `GET` | `/v1/admin/exams/{id}` | Get any user's exam detail |
| `GET` | `/v1/admin/exams/{id}/status` | Poll any user's exam status |
| `GET` | `/v1/admin/exams/{id}/download` | Presigned PDF download for any user |
| `DELETE` | `/v1/admin/exams/{id}` | Delete any user's exam |

All endpoints except the two public ones require a Cognito ID token as a
`Bearer` token. `admin` routes additionally require the caller's `Users` row
role to be `admin` (403 otherwise). Customer exam routes only act on the
caller's own exams; an exam the caller does not own is treated as not-found.

## Next steps

The repository is currently a functioning immutable-exam generator with
authenticated users and role-based administration. Remaining work includes:

1. Improve generator coverage/quality harness as the question library grows.
2. Add pricing, analytics, and richer failure handling (out of scope for the MVP).
3. Configure CI/CD (GitHub Actions) to run `lint`, `test`, and `deploy:ci`.

## License

MIT
