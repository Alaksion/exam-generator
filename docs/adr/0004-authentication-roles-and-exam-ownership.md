# ADR-0004: Authentication, roles, and exam ownership

## Status

Accepted

## Context

The MVP has no user concept: every endpoint is protected by a single shared `x-api-key`
checked in a custom Lambda authorizer (`src/authorizer/index.ts`), and `Exam` rows carry
no owner. Exams are globally visible and globally deletable by anyone holding the key
(`src/shared/repositories/exams.ts`).

We are incrementing the MVP with real users:

- Sign-up via email/password, Google, and Apple; each email must belong to exactly one
  account.
- An email claimed by a social sign-up is locked — it cannot later be used for the
  email/password flow.
- Email/password users can request a password reset, without leaking whether an email
  exists (user enumeration).
- Role-based access control: customers may only touch exams; certification **writes** are
  admin-only.
- Exams belong to the user who generated them.

The client is a separate application that builds its own authentication UI. Deployments
are AWS serverless (SAM).

## Decisions

### 1. A `Users` table is the system of record for identity and role

Cognito handles authentication only. A new `Users` DynamoDB table is the authority for
who each account is and what it may do.

- Partition key: `email` (lowercased/normalized) — unique per account. Keying on email
  lets the write path reject a duplicate atomically (a conditional `PutItem` on
  `attribute_not_exists(email)`), which is what makes "first-claim-wins" hold under
  concurrency: two concurrent sign-ups for the same email cannot both succeed. (Cognito
  already dedupes native sign-ups, whose username is the email; the table-level guard
  closes the cross-provider race — federated vs. native, or Google vs. Apple.)
- Global secondary index: `userId` = the Cognito `sub`, so identity lookup by `sub` still
  works. The `sub` is the value stored as `ownerId` on exams.
- `role`: `customer` or `admin`.

### 2. The email is locked by a Cognito PreSignUp trigger

The pre-sign-up trigger fires for both native and federated sign-ups and is the single
enforcement point for the one-email-one-account rule:

- Native sign-up is blocked if the email already exists on any other account.
- Federated sign-up is blocked if the email already exists (linking is out of scope for
  now).
- The lock is **symmetric / first-claim-wins**: whichever path claims an email first owns
  it; later attempts from either path are rejected with a generic failure.

Both enforcement points (the pre-sign-up read and the post-confirmation write) key on the
email, and the write is atomic, so first-claim-wins holds even when two sign-ups race.

The same trigger provisions the initial `Users` row with `role = customer` (via the
post-confirmation hook), so every authenticated `sub` maps to a `Users` row.

### 3. Roles live in the `Users` table, enforced in the API router

The API authorizer only authenticates the token; it knows nothing about our role model.
Each handler extracts `sub` from `event.requestContext.authorizer.claims`, loads the
`Users` row, and a `requireRole('admin')` guard rejects non-admins with `403` before the
route handler runs.

### 4. Admin promotion: bootstrap script + admin-only endpoint

The chicken-and-egg of the first admin is solved outside the API: a deploy-time script
(`npm run promote:admin -- <sub-or-email>`) sets the first `admin` row directly in the
`Users` table. Ongoing promotion/demotion goes through `PUT /v1/admin/users/{id}/role`
(admin-only), with `GET /v1/admin/users` (search + paginate) so admins can find users.

### 5. Cognito User Pools authorizer replaces the API-key authorizer

API Gateway's built-in Cognito User Pools authorizer validates the JWT and injects claims
into the Lambda event. The `x-api-key` authorizer, `ApiKeyParameter`, and `ApiKeyValue`
are removed. `GET /v1/health` stays unauthenticated for infra probes; `OPTIONS` preflight
is configured to skip authentication so CORS keeps working.

The app client is configured for direct client SDK calls: **no client secret**, with
`USER_SRP_AUTH` + refresh-token flows. The same client is trusted by the API authorizer.

### 6. Hybrid auth UX: client-built UI, Hosted UI for the social OAuth leg

The client owns the sign-up/login/verification/reset UI and calls Cognito's public API
directly (`SignUp`, `ConfirmSignUp`, `InitiateAuth`, `ConfirmForgotPassword`).
Email/password sign-ups must verify their email (Cognito default) before first login.

Google and Apple cannot be driven by raw SDK tokens against a User Pool — the social leg
must go through Cognito's Hosted UI OAuth endpoints (`/oauth2/authorize` → IdP →
callback), after which the client holds the session tokens.

### 7. Password reset is proxied and enumeration-constant

`POST /v1/auth/forgot-password` proxies Cognito's `ForgotPassword`:

- Returns `200 { "status": "ok" }` for both existing and non-existing emails.
- Applies a randomized delay so response times are indistinguishable for existing vs.
  non-existing emails.
- Only genuine failures (downstream errors, invalid client) surface differently.

The code-entry + new-password step (`ConfirmForgotPassword`) is called by the client
directly against Cognito — the code is a single-use secret only the email owner holds, so
it leaks nothing about account existence.

### 8. Exams are user-owned, with separate admin endpoints

`Exam` gains an `ownerId` (= the generating user's `sub`). A new GSI on
`(ownerId, createdAt)` supports "my exams".

- Customer routes (`POST /v1/exams`, `GET /v1/exams`, `GET /v1/exams/{id}`,
  `/status`, `/download`, `DELETE /v1/exams/{id}`) operate **only on the caller's own
  exams**; an exam the caller does not own is treated as not-found.
- Admin routes under `/v1/admin/exams` (`GET` list all users, `GET /{id}`, `/status`,
  `/download`, `DELETE /{id}`) can view/manage any user's exams.
- There is **no** `POST /v1/admin/exams`: admins generate exams through the same
  `POST /v1/exams` flow as customers and own the result. (Creating exams on behalf of
  other users is deferred.)

### 9. Certification reads stay open; writes are admin-only

Requirement 6 is read as "certification **writes** are admin-only":

- `GET /v1/certifications` and `GET /v1/certifications/{id}` remain available to any
  authenticated user — customers must discover a `certificationId` to generate an exam.
- `POST /v1/certifications` and `PUT /v1/certifications/{id}` move under
  `/v1/admin/certifications`.

### 10. Self-identity endpoint

`GET /v1/me` returns the caller's `{ sub, email, role, createdAt }` from the `Users`
row, letting the client render role-aware UI and double as a session-liveness check.

## Consequences

- The `x-api-key` sharing model is gone: every protected route is tied to a real user.
  The API-key authorizer Lambda, SSM parameter, and `ApiKeyValue` parameter are removed
  from the template.
- The `Exam` schema and exam repository gain `ownerId` filtering and a new GSI; existing
  un-owned exam rows are not part of the migration (MVP, no production data).
- Every authenticated request pays for one `Users` row read (role) plus Cognito/JWT
  validation; acceptable for the MVP, and a cache can come later.
- Password-reset enumeration is mitigated at the API boundary with a constant response
  and constant-ish timing; the hard rate limit is still infrastructure (WAF/adaptive
  auth).
- Contradicts the "no authentication" posture of ADR-0001 decision 8 (public resources
  with `x-api-key`), which is superseded by this ADR.