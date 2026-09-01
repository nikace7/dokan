## What

<!-- Summarize the user-visible or operational change. -->

## Why

<!-- Explain the reason and link any issue or design decision. -->

## Verification

<!-- List focused tests plus relevant full-suite, build, lint, and security evidence. -->

- [ ] The complete diff and commit sequence have been self-reviewed.
- [ ] Relevant tests were added or updated before implementation where applicable.
- [ ] Documentation and generated contracts are current.
- [ ] No secrets, credentials, tokens, PII, or cost data appear in logs or fixtures.

## Migration and rollback

<!-- State "No migration" when none exists. Otherwise include forward/reverse steps,
expected duration on the largest tenant, compatibility, and rollback procedure. -->

## Sensitive-change self-review

Sensitive paths:

- [ ] `apps/pricing/`
- [ ] `apps/sales/services/`
- [ ] `core/permissions/`
- [ ] Database migration
- [ ] None of the above

If any sensitive path is checked, record:

- affected business and security invariants;
- tenant-isolation and money, stock, idempotency, or permission evidence;
- migration forward/reverse safety where applicable; and
- the concrete rollback plan.

## UI evidence

<!-- Add screenshots for UI changes; otherwise state "Not applicable". -->
