# Context: mock-exams

## Project

A mock-exam generator for IT certifications such as AWS, Azure, and Google Cloud.
The MVP focuses on two core capabilities:

1. Generating practice exams asynchronously from a catalog of certifications.
2. Listing generated exams and exposing PDF downloads via the API.

This repository contains the serverless backend only. The client static application is intentionally out of scope here and lives in a separate repository.

Authentication, pricing, analytics, and failure handling are explicitly out of scope for the MVP.

## Glossary

- **Certification** — A catalog entry describing an IT certification exam that can be generated. It holds the provider, exam code, human-readable name, version, and the configuration used by the generator.
- **Exam** — A generated, immutable practice exam. This is the primary artifact produced by the system.
- **Question** — A single item inside an `Exam`. The MVP supports only single-answer multiple-choice questions.
- **AnswerOption** — One possible answer for a `Question`. It carries a display label, the answer text, and a flag indicating whether it is the correct answer.
- **Generation Request** — The asynchronous command to create a new `Exam` for a given `Certification`.

## Domain model

### Certification

Identity is unique by `(provider, code)`. The `version` field is mutable metadata, not part of the identity.

Core fields:

- `id` — system-generated UUID.
- `provider` — certification provider: `aws`, `azure`, or `gcp`.
- `code` — provider-specific exam code, e.g. `CLF-C02`.
- `name` — human-readable name, e.g. `AWS Certified Cloud Practitioner`.
- `version` — free-form version metadata, e.g. `v1`.
- `description` — short description.
- `isActive` — whether the certification appears in public listings.
- `config` — generation configuration:
  - `questionCount` — number of questions per exam.
  - `difficultyDistribution` — map of `easy`/`medium`/`hard` weights that must sum to `1.0`.
  - `domains` — list of topics/domains the generator may draw from.
  - `modelId` — Bedrock model identifier.
  - `promptTemplate` — template string used to build prompts for the LLM.

Lifecycle: created and updated through a public, API-key-protected endpoint. `provider` and `code` are immutable after creation. Deletion is not supported; set `isActive` to `false` instead.

### Exam

Identity is a system-generated UUID.

Core fields:

- `id` — UUID.
- `certificationId` — reference to the `Certification` that generated this exam.
- `title` — auto-generated title: `{Certification.name} - Practice Exam {ISO-8601 timestamp}`.
- `status` — `GENERATING`, `READY`, or `FAILED`. The MVP implements only `GENERATING` and `READY`; `FAILED` is reserved for later.
- `createdAt` — creation timestamp.
- `finishedAt` — timestamp when generation completed; `null` until then.
- `s3KeyJson` — S3 key for the canonical JSON artifact.
- `s3KeyPdf` — S3 key for the generated PDF.

The full exam payload (questions, options, explanations) lives in S3 as JSON. DynamoDB stores only the metadata row.

Lifecycle:

```
POST /v1/exams
  │
  ▼
Exam created with status GENERATING
  │
  ▼
SQS message sent to generator
  │
  ▼
Generator calls Bedrock once per question, sequentially
  │
  ▼
Generator uploads JSON + PDF to S3
  │
  ▼
Exam updated to status READY
```

An `Exam` is immutable after it reaches `READY`. `DELETE /v1/exams/{id}` removes both the DynamoDB row and the S3 objects, but no update operation exists.

### Question and AnswerOption

A `Question` is part of exactly one `Exam`.

- `id` — UUID.
- `number` — 1-based position within the exam.
- `domain` — topic tag, e.g. `Cloud Concepts`.
- `difficulty` — `easy`, `medium`, or `hard`.
- `text` — question prompt.
- `options` — list of `AnswerOption` values.
- `explanation` — explanation of the correct answer.
- `reference` — optional link to official documentation.

An `AnswerOption`:

- `id` — UUID.
- `label` — display label, e.g. `A`, `B`, `C`, `D`.
- `text` — answer text.
- `isCorrect` — boolean. Exactly one option per question must be `true`.

## Canonical exam JSON format

```json
{
  "schemaVersion": "1.0.0",
  "id": "exam-uuid",
  "certificationId": "cert-uuid",
  "title": "AWS Certified Cloud Practitioner - Practice Exam 2026-07-28T12:00:00Z",
  "status": "READY",
  "createdAt": "2026-07-28T12:00:00Z",
  "finishedAt": "2026-07-28T12:00:45Z",
  "questions": [
    {
      "id": "question-uuid",
      "number": 1,
      "domain": "Cloud Concepts",
      "difficulty": "medium",
      "text": "Which AWS service provides object storage?",
      "options": [
        { "id": "opt-1", "label": "A", "text": "Amazon S3", "isCorrect": true },
        { "id": "opt-2", "label": "B", "text": "Amazon EC2", "isCorrect": false },
        { "id": "opt-3", "label": "C", "text": "Amazon RDS", "isCorrect": false },
        { "id": "opt-4", "label": "D", "text": "Amazon CloudFront", "isCorrect": false }
      ],
      "explanation": "Amazon S3 is the object storage service.",
      "reference": "https://docs.aws.amazon.com/s3/latest/userguide/Welcome.html"
    }
  ]
}
```

## Error vocabulary

Public API errors use a consistent shape:

```json
{
  "error": "CamelCaseErrorCode",
  "message": "Human-readable description"
}
```

Examples:

- `InvalidRequest` — `400`
- `ExamNotFound` — `404`
- `ExamNotReady` — `409` (exam exists but is still `GENERATING` or `FAILED`)
- `InternalError` — `500`
