# Git Workflow

How work lands on `main`. This doc describes the workflow as practiced and
enforced — the CI gates below are quoted from `.github/workflows/ci.yml`; if
they drift apart, the workflow file is right and this doc gets fixed in the
same PR that changes it.

---

## 1. Trunk-based development

- `main` is always deployable and protected. No direct pushes.
- Short-lived branches: `feat/…`, `fix/…`, `chore/…`, `docs/…`, `test/…`,
  `refactor/…`. A branch lives **≤ 3 days**; if the work is bigger, split it.
- PRs are merged **preserving commits — no squash**. The per-commit unit
  history is the review trail (see §2). Delete the branch on merge.
- Parallel work that would collide on the same files uses git worktrees
  under `.worktrees/` (gitignored), one branch per worktree.

## 2. Small atomic commits

Each commit is one logical unit that stands on its own. A feature branch
reads like a build order, e.g. the sales feature landed as:

```
feat(sales): invoice models, number sequence, migration
feat(sales): create-sale service with ledger posting
test(sales): service invariants, concurrency, API, isolation
feat(sales): sales API endpoints
```

### Conventional Commits

Format: `type(scope): summary`, scope = the app or area touched.

| Type | Use |
|---|---|
| `feat` | New behaviour |
| `fix` | Bug fix |
| `chore` | Tooling, deps, formatting, repo hygiene |
| `docs` | Documentation only |
| `test` | Tests only |
| `refactor` | No behaviour change |

Real scopes from history: `sales`, `inventory`, `pricing`, `payments`,
`purchasing`, `customers`, `expenses`, `reports`, `audit`, `notifications`,
`tenants`, `accounts`, `platformadmin`, `catalog`, `core`, `web` (tenant
frontend), `frontend`, `ops`, `infra`, `ci`.

The commit body answers **why**, not what — the diff already says what.

## 3. CI gates (all required)

Every PR and every push to `main` runs `.github/workflows/ci.yml`. All jobs
must pass:

**Backend job** (against real Postgres 16 in CI):

- `ruff check .` — lint
- `ruff format --check .` — format check
- `mypy .` — type check
- `python manage.py makemigrations --check --dry-run` — no unmigrated model
  changes
- `pytest --cov --cov-fail-under=80` — tests with **coverage floor 80%**
  (100% required on `apps/pricing/`, `apps/sales/services/`,
  `apps/inventory/services/`, `core/calendar/` — the four modules where a bug
  costs a shop money; enforced by the suites themselves, see [ARCHITECTURE.md](ARCHITECTURE.md)). The
  tenant-isolation suite is part of this run against real Postgres — the test
  that protects the business.

**Frontend job** (runs when `frontend/package.json` exists):

- `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build`
- `npm audit --omit=dev --audit-level=critical`
- Builds the production frontend and Caddy images and smoke-tests the edge
  stack (`docker/test-edge-stack.sh`)

**Other jobs:**

- `gitleaks` — secret scan over full history
- `recovery` — exercises the backup/restore/WAL paths against real Postgres
  and MinIO

## 4. Review rules

- **Two approvers** for anything touching `apps/pricing/`,
  `apps/sales/services/`, `core/permissions/`, or migrations.
- Everything else: one approval.
- Reviewers check the invariants, not just the diff: stock only via the
  ledger, no cost leaks, completed invoices untouched, tenant only from the
  subdomain, audit calls explicit.

## 5. Migration discipline

The rules that prevent 3 a.m. pages (SYSTEM_DESIGN §9.5):

| Rule | Why |
|---|---|
| One logical migration per PR | Bisecting a bad migration is impossible otherwise |
| Never edit a migration that has run in prod | Write a new one |
| Additive first: nullable column → backfill separately → non-null later | Locks on a big table during deploy = downtime |
| No `RunPython` without `reverse_code` | Rollback must be possible |
| Data migrations for tables > 100k rows run as Celery tasks | Migration timeouts kill deploys |
| Index creation uses `CONCURRENTLY` (`AddIndexConcurrently`, `atomic = False`) | A plain `CREATE INDEX` locks writes — billing stops |
| Every migration PR states expected duration on the largest tenant | Forces the author to actually check |

`makemigrations --check --dry-run` in CI means a model change without its
migration cannot merge.

## 6. Releases

- **SemVer tags** on `main`.
- `CHANGELOG.md` (repo root) is updated per release from the conventional
  commits, plus a plain-language **"what shopkeepers get"** section — the
  audience for that section is the shop owner, not the developer.
- Hotfixes: `fix/…` branch off `main`, same gates, expedited review, tag a
  patch release.

## 7. Committing rules for agents and humans alike

- Never commit secrets; gitleaks scans full history on every PR.
- Never amend or force-push a branch after its PR has reviewers.
- Do not rewrite `main` history. Ever.
