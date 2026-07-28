# Architecture Decision Records

One file per significant decision: `NNNN-short-title.md`, numbered sequentially,
never reused. ADRs record **why**, so a future change can tell whether the
reasoning still holds.

## Format

```markdown
# NNNN. Title

**Status:** Accepted | Superseded by NNNN | Deprecated
**Date:** YYYY-MM-DD

## Context      — the forces and constraints
## Decision     — what we chose
## Alternatives — what we rejected and why (optional but encouraged)
## Consequences — what this makes easier, harder, or required
```

Rules:

- Status starts as `Accepted`. Never rewrite a decided ADR to hide history —
  supersede it with a new ADR instead.
- Small, obvious choices do not need an ADR. If you'd debate it in a PR review
  twice, it does.
- Larger design-level choices already made in `docs/SYSTEM_DESIGN.md` §0/§12
  (RLS over schema-per-tenant, denormalized BS dates, weighted-average costing,
  PWA over native) are not duplicated here; this directory starts with the
  implementation-level decisions the design left open.

## Index

| # | Title | Status |
|---|---|---|
| [0001](0001-jwt-claim-shape.md) | JWT claim shape and token audiences | Accepted |
| [0002](0002-api-contract-toolchain.md) | API contract toolchain (OpenAPI 3.1 → typed TS client) | Accepted |
| [0003](0003-barcode-format.md) | Barcode format (Code 128 in-house, EAN-13 accepted) | Accepted |
| [0004](0004-sms-gateway.md) | SMS gateway behind a provider interface | Accepted |
