# exam-generator

Serverless backend for a mock-exam generator. It exposes a public REST API and an asynchronous worker that creates practice exams for IT certifications (AWS, Azure, GCP) using Amazon Bedrock.

The architecture is described in [`CONTEXT.md`](./CONTEXT.md) and [`docs/adr/0001-domain-model-and-aws-mvp-architecture.md`](./docs/adr/0001-domain-model-and-aws-mvp-architecture.md).

## Architecture overview

```
┌──────────────┐      HTTP       ┌──────────────┐
│ API Gateway  │ ───────────────▶ │  API Lambda  │
└──────────────┘   x-api-key     └──────────────┘
                                              │
                                              ▼
                            ┌─────────────────┼─────────────────┐
                            ▼                 ▼                 ▼
                    ┌───────────────┐ ┌───────────────┐ ┌───────────────┐
                    │ Certifications│ │    Exams      │ │     S3        │
                    │    DynamoDB   │ │   DynamoDB    │ │  Artifacts    │
                    └───────────────┘ └───────────────┘ └───────────────┘
                                              │
                                              ▼ SQS
                                    ┌──────────────────┐
                                    │ Generator Lambda │ ──▶ Bedrock
                                    └──────────────────┘
```

## Tech stack

- **AWS SAM** — infrastructure as code and local emulation
- **TypeScript / Node.js 20** — Lambda runtime
- **API Gateway (HTTP API)** — public endpoints with a custom API-key authorizer
- **DynamoDB** — metadata for certifications and exams
- **S3** — canonical JSON and generated PDF artifacts
- **SQS** — asynchronous generation queue
- **Amazon Bedrock** — LLM question generation

## Prerequisites

- [Node.js 20](https://nodejs.org/) (see `.nvmrc`)
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

Choose a strong API key value and deploy with it (never commit the real key):

```bash
make deploy
# SAM will prompt for the ApiKeyValue parameter
```

For CI/CD, pass the key via environment/parameter overrides instead of committing it:

```bash
sam deploy --parameter-overrides ApiKeyValue=$EXAM_GENERATOR_API_KEY
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

- An API Gateway with CORS and API-key authorization
- Three Lambda functions: API handler, generator worker, and API-key authorizer
- Two DynamoDB tables: `certifications` and `exams` with GSIs
- An SQS queue with a dead-letter queue for generation jobs
- An S3 bucket for exam JSON and PDF artifacts

After deployment, SAM prints the `ApiUrl` output. Use it with the `x-api-key` header:

```bash
curl -H "x-api-key: $EXAM_GENERATOR_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"certificationId":"cert-uuid"}' \
     "${API_URL}/v1/exams"
```

### 6. Seed the certification catalog

The catalog needs at least one Certification before exams can be generated. Seed the AWS Cloud
Practitioner record (the seed data lives in `src/test/fixtures/certification.ts`):

```bash
export DYNAMODB_CERTIFICATIONS_TABLE=$(aws cloudformation describe-stacks --stack-name exam-generator \
  --query "Stacks[0].Outputs[?OutputKey=='CertificationsTableName'].OutputValue" --output text)
npm run seed:certifications
```

Re-running is safe and idempotent — the record uses stable ids and is overwritten.

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
│   ├── authorizer/            # API-key authorizer Lambda
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

## API endpoints

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/v1/certifications` | Create a certification |
| `GET` | `/v1/certifications` | List active certifications |
| `GET` | `/v1/certifications/{id}` | Get a certification |
| `PUT` | `/v1/certifications/{id}` | Update certification metadata |
| `POST` | `/v1/exams` | Request a new exam generation |
| `GET` | `/v1/exams` | List ready exams (with filters) |
| `GET` | `/v1/exams/{id}` | Get full exam detail |
| `GET` | `/v1/exams/{id}/status` | Poll generation status |
| `DELETE` | `/v1/exams/{id}` | Delete an exam and its artifacts |

All endpoints require the `x-api-key` header configured at deploy time.

## Next steps

The repository is currently a skeleton with stub handlers. The remaining implementation work includes:

1. Implement certification CRUD business logic in `src/api/index.ts`.
2. Implement exam generation request handling and SQS message production.
3. Implement the generator worker: load certification config, call Bedrock per question, build the canonical JSON, render the PDF, upload to S3, and mark the exam `READY`.
4. Add presigned PDF download endpoints.
5. Add Vitest tests for handlers and repositories.
6. Add input validation (Zod schemas are already defined in `src/shared/types.ts`).
7. Configure CI/CD (GitHub Actions) to run `lint`, `test`, and `deploy:ci`.

## License

MIT
