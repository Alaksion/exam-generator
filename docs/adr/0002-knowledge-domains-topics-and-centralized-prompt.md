# ADR-0002: Knowledge domains, topics, and centralized prompt engineering

## Status

Accepted

## Context

The MVP certification model stored generation configuration on the `Certification.Config`
(`config` in `types.ts`): a flat `domains: string[]`, a per-cert `promptTemplate`, and a
per-cert `modelId`. This tied prompt engineering to each catalog entry, offered no way to
express which knowledge areas an exam covers or how heavily they are weighted, and had no
notion of topics at all.

We are redesigning how certifications are created and how exams are generated:

- Creating a certification should capture **knowledge domains with weights** (summing to
  100%) and **topics attached to each domain**.
- Generating an exam should honor **both** a knowledge-domain distribution and a global
  difficulty distribution.
- Prompt engineering should be **centralized**: one fixed prompt with key-value
  substitution, not per-cert user-supplied templates.

## Decisions

### 1. A knowledge domain is a structured, weighted, topic-bearing entity

`config.domains` changes from `string[]` to:

```
[{ id, name, weight, topics: [{ id, name }] }]
```

- `id` — system-generated at create/update time. The client supplies only names, weights,
  and topic names.
- `name` — display name, e.g. `Cloud Concepts`.
- `weight` — integer percent. Each domain's weight must be ≥ 1 and the weights must sum
  to exactly `100` (validated in zod via `superRefine`). There must be at least one domain;
  a single domain therefore has weight `100`.
- `topics` — list of `{ id, name }` subtopics scoped to that domain. Ids are
  system-generated.

Using `id` (not `name`) as identity means a rename never detaches topic links or breaks
question traceability.

### 2. Difficulty distribution becomes integer percents

`config.difficultyDistribution` (`easy`/`medium`/`hard`) moves from fractions (`0..1`
summing to ≈1.0 with a tolerance) to integer percents summing to exactly `100`, using the
same validation as domain weights. It remains a global, user-editable config property and
is applied within every domain's allocated question count (not per domain).

### 3. Several certification properties are removed or retained

- **Removed**: `version` (unused free-form metadata; exam codes already encode revisions).
- **Removed**: `config.modelId` — the Bedrock model is an application-level concern, driven
  by the global default, not per certification.
- **Removed**: `config.promptTemplate` — prompt engineering is centralized (see decision 6).
- **Retained**: `provider`, `code`, `name`, `description`, `isActive`,
  `config.questionCount`.

### 4. Exam generation uses a two-stage largest-remainder allocation

`buildQuestionContexts` is replaced by a deterministic, exact integer allocation that
satisfies both distributions simultaneously:

1. **Allocate by domain**: each domain receives
   `floor(weight / 100 × questionCount)` questions; the leftover
   (`questionCount − Σ counts`) is distributed one each to the domains with the largest
   fractional remainders. Counts thus sum exactly to `questionCount`. If `questionCount` is
   smaller than the number of domains, a low-weight domain may legitimately receive `0`
   questions (weights are targets, not hard quotas).
2. **Allocate by difficulty within each domain**: each domain's count is apportioned across
   `easy`/`medium`/`hard` against the global difficulty distribution, again by
   largest-remainder.
3. **Pick topics**: each resulting `(domain, difficulty)` slot draws a topic uniformly at
   random.

This replaces the previous round-robin domain cycling and bucket-ordered difficulty list,
which were combined only by index and honored no true joint distribution.

### 5. Questions record their provenance

Each generated `Question` now carries the domain and topic provenance for traceability:

- `domain` — domain name, `domainId` — domain id.
- `topic` — topic name, `topicId` — topic id.

Topics are selected **without replacement per exam per domain** (shuffle topics, one per
slot; repeat only if a domain is drawn more times than it has topics), so a practice exam
does not pile multiple questions onto the same topic.

### 6. Prompt engineering is centralized in one fixed prompt

The per-cert `promptTemplate` is removed. A single prompt constant lives in the generator
and is rendered with key-value substitution (reusing `renderPrompt`):

- `{certificationName}`, `{certificationCode}`
- `{knowledgeDomain}`, `{topic}`
- `{difficulty}`, `{questionNumber}`

The prompt instructs the model to limit scope to the level expected for the certification
and to generate a question for the given domain, topic, and difficulty.

### 7. The strict JSON output format is derived from the zod schema

The prompt embeds a strict rule describing the JSON output the application will
deserialize. The example/spec is **derived from the `ParsedQuestionSchema` zod schema**
(the single source of truth for parsing), so the format described to the model and the
format enforced by `questionParser` can never drift apart. The rule enforces the exact
field set (text, options with exactly one correct, explanation, optional reference).

### 8. The change is breaking; no runtime migration

DynamoDB for the Certification is schemaless — the "schema" is the zod contract in
`types.ts`. Because this is an MVP with no production data, we treat the reshape as a
breaking change: update the zod contract, reseed certification records, and refresh
fixtures. No data-migration code is written.

### 9. The canonical exam artifact format is versioned

The FullExam `schemaVersion` is bumped from `1.0.0` to `2.0.0` to advertise the richer
`Question` format (added `topic` and ids). Existing immutable exams keep their original
`schemaVersion` and remain self-describing; new exams use the new format.

## Consequences

- Certification creation now captures a realistic, provider-published structure: weighted
  knowledge domains with attached topics.
- Exam generation produces an exact, reproducible joint (domain × difficulty) distribution
  with no rounding drift.
- Prompt engineering is a single, versionable constant in code rather than per-cert data;
  the output contract is enforced by derivation from the parser schema.
- The API for creating/updating a certification changes (ids are system-generated;
  `version`, `modelId`, and `promptTemplate` disappear; `config.domains` and
  `difficultyDistribution` change shape).
- Existing stored certifications and fixtures must be reshaped; artifact readers must be
  able to handle both `1.0.0` and `2.0.0` exams.
