# ADR-0003: Topic context for scoped question generation

## Status

Accepted

## Context

Generated questions are scoped to a topic by **name only**: the prompt
(`QUESTION_PROMPT_TEMPLATE` in `src/shared/services/bedrock.ts`) says "generate a
single question scoped to the knowledge domain {knowledgeDomain} and topic {topic}".
A topic name like `Amazon S3` tells the model almost nothing about the intended
coverage — buckets, storage classes, lifecycle, replication, encryption, and so on —
so the generator's output quality depends on the model's own guesses about scope.

The people authoring the certification catalog know precisely what a topic is meant
to cover. The model, by default, is scoped by name only. We need an author-provided
description of what the topic actually is so the model can generate on-topic questions
reliably.

## Decisions

### 1. `Topic` gains a required free-form `context` field

`Topic` changes from `{ id, name }` to `{ id, name, context }`. The context is free-form
prose, not structured facets, for the MVP — it is the fastest to author and matches how
catalog authors naturally elaborate a topic.

The client-facing `DomainInput.topics` changes from `z.array(z.string().min(1))` to an
array of objects:

```
topics: [{ name, context }]
```

### 2. Context is required and bounded

`context` is **required**: an optional field would let topics be created without the
very guidance this change exists to supply, silently regressing generation quality.

- `min(20)` — prevents one-word "contexts" that add no scope.
- `max(1500)` — bounds prompt cost; the context is embedded in every question prompt,
  and Bedrock is called once per question with bounded concurrency. 1,500 characters is
  roughly 375 tokens of genuine scope guidance per question.

### 3. Context is injected into the prompt as a hard scope boundary

`PromptContext` gains a `topicContext` field and `QUESTION_PROMPT_TEMPLATE` gains a
second topical sentence that treats the context as a boundary, not a suggestion:

> The question must stay strictly within the scope described by this topic context:
> {topicContext}

The context flows from the stored `Topic` through `buildQuestionContexts` →
`QuestionAttributes` → `buildPromptContext` → `PromptContext`. Hard boundary wording
(`strictly within`) prevents the model from drifting into adjacent features the author
did not enumerate.

### 4. Context is catalog-only; generated artifacts are unchanged

The context reaches only the Certification catalog and the prompt. `Question` keeps its
existing provenance fields (`topic`, `topicId`) and the canonical exam JSON and PDF are
unchanged. No `schemaVersion` bump is needed because the exam artifact format is
byte-for-byte identical. The context is internal generation guidance, not exam content.

### 5. Update semantics: preserve id, adopt client context

Topic identity within a domain remains **by name** for relinking
(`withGeneratedDomainIds` in `src/shared/services/certification.ts`). When an input topic
name matches a stored topic, the stored `id` is preserved and the client-supplied `name`
and `context` are authoritative — the client sends the full config on every update, so its
context simply becomes the latest truth. A rename remains delete-plus-add (new id), exactly
as before; context does not secretly follow a renamed topic.

### 6. Context is exposed in public API responses

Public certification listings (`GET /v1/certifications`, `GET /v1/certifications/{id}`,
via `toPublicCertification`) include the context. This refines ADR-0001 decision 13, which
hid the old `promptTemplate`: that template was application-generated and never authored by
a client, whereas topic context is user-authored catalog data on a par with weights and
topic names. Exposing it is also required for in-place editing — the update contract already
requires sending the full config (decision 5), so a client that hides the context between
GET and PUT would lose it.

### 7. Breaking change; no runtime migration

Requiring `context` on every stored topic breaks the stored-`Certification` zod contract.
Following ADR-0002 decision 8, this is treated as a breaking change: update the zod contract,
reseed certification records, and refresh fixtures. No data-migration code is written.

### 8. Topics only; domain context deferred

Only topics receive context. `KnowledgeDomain` is unchanged. The same pattern could be
applied to domains later without structural change, but adding it now would triple the
surface (schema, prompt, fixtures, tests) for speculative benefit.

## Consequences

- Catalog authors can now pin down what each topic actually covers, and the model receives
  that scope as a hard boundary on every generated question.
- The create/update API contract changes: topics are submitted as `{ name, context }`
  objects, and context is required.
- Prompt cost per question grows by the context length (bounded at 1,500 characters).
- Questions, the canonical exam JSON, the PDF, and the exam `schemaVersion` are unaffected.
- Existing fixtures, tests, and any seeded certification records must be reshaped with
  author-supplied context prose; stored records are reseeded per ADR-0002 decision 8.