# 0004. SMS gateway — abstract behind a provider interface

**Status:** Accepted
**Date:** 2026-07-27

## Context

SMS is load-bearing in Nepal: password reset OTPs, receipts ("cheaper than
paper"), due reminders, festival/birthday campaigns, and support-session
notifications to tenant owners. SYSTEM_DESIGN names candidate providers
(Sparrow SMS / Aakash SMS, Appendix A) and places SMS in the `notifications`
app, with delivery via Celery, per-message logging (`sms_log` with provider,
status, cost), and plan-metered credits (`sms_credits_per_month`). The design
deliberately does **not** pick a vendor, and Phase 1 has no hard SMS dependency
beyond OTP.

Risks the decision must address:

- Nepali SMS providers change pricing, routes, and API quality; vendor lock-in
  in the codebase would make switching a rewrite.
- Delivery is asynchronous and unreliable; sending must not block request paths
  (billing, login).

## Decision

**All SMS goes through a provider interface in the `notifications` app. This ADR
records the interface requirement, not the vendor.** A Nepal provider (e.g.
Sparrow SMS or Aakash SMS) is chosen at integration time in Phase 2 based on
current pricing, delivery rates, and sender-ID support.

Interface contract:

```python
# apps/notifications/providers/base.py
class SmsProvider(Protocol):
    name: str
    def send(self, to_phone: str, body: str) -> ProviderReceipt: ...
        # returns provider message id or raises ProviderError (retryable vs final)
    def fetch_status(self, provider_message_id: str) -> DeliveryStatus: ...
```

Rules:

- **One interface, vendor adapters.** Provider HTTP details live only in
  `apps/notifications/providers/<vendor>.py`. Nothing outside `notifications`
  imports a vendor SDK or knows a vendor exists.
- **Async by default.** Sending is a Celery task with bounded retries and
  backoff; OTP sending may be synchronous only if measured p95 stays acceptable,
  and still through the same interface.
- **Everything is logged** to `sms_log`: template, body, provider, status
  transitions (`QUEUED → SENT → DELIVERED|FAILED`), and per-message cost.
  Delivery reports are fetched/polled per provider capability.
- **Template-driven.** Callers name a template (`receipt`, `otp`,
  `due_reminder`) and supply context; providers never see ad-hoc strings. This
  keeps content reviewable and Nepali/English variants in one place.
- **Cost accounting per message** feeds `sms_credits_per_month` plan limits and
  `tenant_usage_snapshot.sms_used`.
- **Provider configuration (credentials, sender ID) via secrets/settings**,
  never in code; a disabled provider fails loudly at startup if SMS is required
  for an enabled feature.

## Alternatives

- **Direct vendor SDK calls where needed** — rejected; the second vendor or a
  pricing switch becomes a cross-codebase change.
- **A third-party multi-provider aggregator (e.g. Twilio)** — rejected for now;
  per-message cost into Nepal is significantly higher than local providers.
  Revisitable if delivery reliability of local providers proves unacceptable —
  the interface makes that a config change.

## Consequences

- Vendor selection is deferred to Phase 2 integration time without blocking
  Phase 1: OTP and `sms_log` are built against the interface with a fake/log
  provider for dev and staging.
- Switching or adding a provider is a new adapter file plus configuration —
  no changes to sales, accounts, or customers code.
- Delivery status and cost are first-class data, enabling per-tenant SMS
  billing and visible failure states instead of silent loss.
- The retry policy (bounded, with final `FAILED` state visible in `sms_log`)
  means a provider outage degrades to queued messages, not failed logins or
  blocked bills.
