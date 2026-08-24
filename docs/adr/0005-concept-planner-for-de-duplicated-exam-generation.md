# ADR-0005: Concept planner for de-duplicated exam generation

## Status

Accepted

## Context

Exam generation fans out one stateless Bedrock request per question slot
(`generateExamQuestions` → `mapWithConcurrency` in
`src/shared/services/bedrock.ts`). Each slot is scoped by its domain, topic, and
topic context (ADR-0003), but the requests share no conversational context, so the
model frequently produces multiple questions addressing the exact same concept —
e.g. several questions about S3 bucket policies in one exam.

We want to retain de-duplication context during generation without paying for a
fully sequential pipeline. The chosen design (per-topic **concept planner**, option
1 of the earlier exploration) adds a single planning step before the question
fan-out that assigns each slot a *distinct concept* — a narrow sub-facet of the
slot's topic context — so no two questions in the same topic collide.

Because this is a new generator workflow under active testing, the existing
generation path must remain untouched and the two paths are switched by a feature
flag.

## Decisions

### 1. A concept is a sub-facet of the slot's topic context

A `concept` is a short, unique angle for a question that is drawn *strictly inside*
the slot's existing `topicContext` — e.g. given topic context "S3: buckets,
lifecycle, replication, encryption", one slot gets "lifecycle transitions" and
another gets "bucket policy `aws:PrincipalArn` condition". The concept may not
reinterpret or broaden beyond the topic context (preserving the author-pinned hard
boundary from ADR-0003, decision 3).

### 2. Slot allocation is unchanged; the planner de-duplicates within it

`buildQuestionContexts` (two-stage largest-remainder allocation from ADR-0002,
decision 4) continues to produce the ordered slots `{ number, difficulty, domain,
topic, topicContext }`. The planner never overrides domain, topic, or difficulty —
it only assigns each slot a concept within that slot's scope, making "concept
conflicts with the slot's domain" structurally impossible.

### 3. Planning is one Bedrock call per topic, run in parallel

Slots are grouped by `topicId`. One planner call is issued per topic group, and the
calls run in parallel through the existing `mapWithConcurrency` pool. De-duplication
is scoped **within a topic** — two questions from different topics or domains may
touch overlapping areas, which is acceptable.

### 4. The planner returns a full 1:1 list and is parsed via a zod-derived contract

Each planner call returns `[{ number, concept }]` for every slot in that topic
group (full list, not sparse overrides). The output contract is derived from a new
`ConceptPlanSchema` zod type via the existing format-spec mechanism, so the prompt's
described format can never drift from the parser. Concepts are zipped back onto
slots by `number`.

### 5. Structure is verified; uniqueness is trusted

The planner's output must contain exactly the slot numbers for its topic group. Any
mismatch (missing, extra, or out-of-range numbers) is a structural failure: retry
the planner up to `config.bedrockMaxAttempts`, then hard-fail the exam. Within that
bound, concept **uniqueness** is trusted — we do not run a deterministic
collision/scope check. This mirrors the existing posture where a question that
never parses fails the exam after a bounded retry.

### 6. The concept reaches the prompt as an inner focus, keeping both boundaries

`PromptContext` gains a `concept` field and `QUESTION_PROMPT_TEMPLATE` gains a
sentence instructing the model to focus on exactly that concept, distinct from all
other questions. The question prompt keeps **both** boundaries: `topicContext`
remains the outer author-pinned scope (ADR-0003), `concept` is the inner focus.

### 7. `Question` gains an optional `concept` for provenance

The stored `Question` gains an optional `concept` field. It is additive — old
artifacts without the field remain valid, and the field is preserved in the
canonical exam JSON. PDF/renders may use it where useful.

### 8. The planner output is persisted

The raw planner responses are stored alongside the existing `raw.json` question
responses, as a `plan.json` artifact, for traceability.

### 9. Regeneration retries the same concept

The existing `regenerateQuestion` retry (used when a parsed question fails
validation) is unchanged in behavior: it retries the same concept by threading the
slot's concept through `PromptContext`. No new cross-question uniqueness check is
added at regeneration time.

### 10. The new workflow is feature-flagged; the old path is untouched

A new env-var flag `EXAM_GENERATION_V2` (lazy getter in `src/shared/config.ts`,
defaulting to `false`, documented in `.env.example`, wired into the generator
function's environment in `infra/template.yaml`) routes the generator handler at
the top of the generation block. When the flag is off, the existing
`generateExamQuestions` → `parseExamQuestions` flow runs byte-for-byte unchanged.
When on, a self-contained V2 flow runs the planner step and threads concepts
through to the fan-out.

### 11. The exam `schemaVersion` is bumped only under the flag

Because stored questions now carry `concept` under the flag, a new constant
`CANONICAL_EXAM_SCHEMA_VERSION_V2 = '3.0.0'` is used only when the flag is on. The
old path keeps `CANONICAL_EXAM_SCHEMA_VERSION = '2.0.0'`, so old artifacts and
consumers are unaffected.

## Consequences

- Exam generation gains a single extra planning phase (one Bedrock call per topic,
  parallel) before the question fan-out, bounding prompt size regardless of exam
  length.
- Repeated concepts within a topic are structurally prevented by the planner, with
  the residual risk (trusted uniqueness) limited to cross-topic overlaps.
- The generator handler now branches on the feature flag; the old path stays intact
  for testing and rollback.
- The canonical exam JSON under the flag is `schemaVersion 3.0.0` with optional
  `concept` per question and an additional `plan.json` artifact.
- No changes to the certification catalog model, API contracts, or the
  `buildQuestionContexts` allocation logic.