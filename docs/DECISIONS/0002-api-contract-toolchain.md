# 0002. API contract toolchain — OpenAPI 3.1 from DRF, generated TS client

**Status:** Accepted
**Date:** 2026-07-27

## Context

The frontend is a TypeScript SPA and Phase 3 adds a public/integration API.
SYSTEM_DESIGN §8.4 states: "OpenAPI 3.1 generated from DRF, typed TS client
generated from that. No hand-written API types." Hand-written API types on both
sides of the wire drift apart silently — the failure mode is a field renamed in
DRF that TypeScript still believes exists, caught only in production. The
decision left open is *which* generators.

## Decision

- **Schema generation:** `drf-spectacular`, producing an OpenAPI 3.1 document
  from the DRF views/serializers. It is the maintained, DRF-native generator
  with explicit 3.1 support.
- **Client generation:** `openapi-typescript` (and its fetch client) generating
  typed request/response types into `frontend/src/lib/api/`. The generated files
  are build artifacts — regenerated in CI and before frontend builds, never
  hand-edited.
- **CI contract check:** CI regenerates the schema and fails the build if the
  committed schema artifact differs (schema is committed so diffs are reviewable
  in PRs), and the frontend type-checks against the freshly generated client.
- **No hand-written API types anywhere.** If a type is needed on the frontend,
  it comes from the generated client or is derived from it.

Conventions the schema must express (§8.4): the `{data, meta, error}` envelope,
machine-readable error codes, cursor pagination on transaction lists,
`Idempotency-Key` as a required header parameter on `POST /sales` and
`POST /payments`.

## Alternatives

- **Hand-written TS interfaces** — rejected; drift is guaranteed at this team
  size and the design explicitly forbids it.
- **`drf-yasg`** — rejected; effectively unmaintained and OpenAPI 2.0-oriented.
- **Runtime-validated clients (zod schemas shared by hand)** — rejected for now;
  generation from the backend keeps one source of truth. Runtime validation can
  be layered on later for the offline sync boundary if needed.

## Consequences

- Serializer changes automatically surface as frontend type errors — the
  compiler becomes the contract test.
- API changes are reviewable as schema diffs in the PR.
- Serializers must be annotated carefully (explicit serializers on views,
  `extend_schema` for non-obvious endpoints) or the schema — and therefore the
  client — degrades. This discipline is required, not optional.
- The error-code table must be kept in the schema/enum so the UI can switch on
  `PRICE_BELOW_MINIMUM` vs `CREDIT_LIMIT_EXCEEDED` as required by §8.4.
