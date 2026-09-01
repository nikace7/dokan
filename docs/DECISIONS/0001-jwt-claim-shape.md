# 0001. JWT claim shape and token audiences

**Status:** Accepted
**Date:** 2026-07-27

**Amended:** 2026-08-31 — normal tenant tokens are bound to a revocable
registered-device session.

## Context

Authentication is Django auth + SimpleJWT (SYSTEM_DESIGN §0, §8.4): phone +
password login, access token 30 minutes, refresh token 30 days with rotation.
The design fixes the lifetimes but not the claim payload, and three constraints
depend on the claims being right:

1. **Tenant binding** — a token is valid for exactly one tenant; reuse on another
   subdomain is a hard 403 plus an audit event (§2.2).
2. **Two actor populations** — platform users (`platform_user`) and tenant users
   (`user`) are separate tables; a super admin never gets a tenant user row
   (§2.4). Tokens must be distinguishable so a platform token can never be
   presented to a tenant endpoint and vice versa.
3. **Impersonation** — support sessions issue short-lived tokens that must carry
   the acting platform user's identity for audit attribution (§2.6).

## Decision

**Access token** (30 min), claims:

| Claim | Value |
|---|---|
| `sub` | user id (uuid) — tenant `user.id`, or `platform_user.id` for platform tokens |
| `tenant` | tenant uuid; absent on platform-realm tokens that are not impersonation sessions |
| `aud` | token audience: `tenant` for tenant users, `platform` for platform users — the two realms are separate and mutually rejected |
| `token_use` | `access` |
| `jti` | unique id; used for the impersonation denylist and refresh rotation |
| `sid` | tenant `auth_session.id` for normal tenant tokens; absent on platform and impersonation tokens |

**Refresh token** (30 days, rotating): `sub`, `aud`, `tenant` (where
applicable), `token_use: refresh`, `jti`, and `sid` for a normal tenant user.
Rotation on every refresh; reuse of a rotated-out refresh token invalidates the
chain. Access and refresh both require the referenced session to remain active
and unexpired.

**Impersonation token** adds:

| Claim | Value |
|---|---|
| `sub` | the impersonated tenant user's id |
| `tenant` | the tenant uuid |
| `act` | the acting `platform_user.id` — "on behalf of"; stamped onto `audit_log.impersonated_by` for every write |
| `scope` | `read_only` (default) or `read_write` |
| `exp` | ≤ 60 minutes (15/30/60 chosen at session start) |

Impersonation tokens carry `aud: tenant` (they act inside a tenant) and their
`jti` is denylisted in Redis when the session ends, so "End now" is instant.

Enforcement: after authentication, the request pipeline asserts
`token.tenant == request.tenant` (subdomain-derived), `token.aud` matches the
host realm (`admin.` host vs `<slug>.` host), and `token_use == access` on API
calls. Normal tenant tokens also resolve `sid` under tenant RLS and reject a
missing, expired, or revoked session immediately. Any realm or tenant mismatch
is a 403 and an audit event.

## Alternatives

- **Session cookies per subdomain** — rejected; the PWA and offline sync model
  fit bearer tokens better, and Django auth + SimpleJWT is the design's
  committed stack.
- **One user table with a `is_platform` flag** — rejected in the design (§2.4);
  separate tables prevent the offboarded-support-account hole.
- **Permissions embedded in the token** — rejected; permission changes must take
  effect within minutes (Redis cache, 5 min TTL), not at token expiry.

## Consequences

- Normal tenant requests perform one indexed `auth_session` lookup so logout,
  password reset, password change, and owner-triggered device revocation take
  effect immediately. The lookup is tenant-prefixed and RLS-protected; its
  `last_seen_at` write is bounded to once per five minutes.
- Every write during impersonation is attributable to a real platform user via
  `act` — the audit trail never shows a support action as the tenant owner's.
- Refresh-token rotation plus the Redis jti denylist gives instant revocation
  for impersonation. Normal tenant sessions use durable database revocation;
  password reset revokes every device and password change keeps only the
  current device.
- The `tenant` claim makes JWTs non-portable across tenants by construction;
  any future multi-tenant user (e.g. an accountant serving several shops) needs
  one token per tenant, which is the intended behaviour.
