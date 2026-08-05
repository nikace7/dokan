# IRD Compliance — Computerized Billing & CBMS Sync

**Verify all of this with a Nepali chartered accountant or the IRD before
enabling live sync (design §1185).** Rules change, and the penalty for
guessing wrong lands on the shop, not on us. This document describes what
is IMPLEMENTED, not what the law currently demands.

---

## 1. Computerized-billing rules the system enforces structurally

| Requirement | Implementation |
|---|---|
| Gapless invoice numbering per fiscal year | Row-locked `number_sequence` per branch per `fiscal_year_bs` per doc_type (`core/numbering.py`); a rollback releases the number, so no gaps and no burned numbers |
| No bill deletion; corrections via credit note | COMPLETED invoices are never updated or deleted (invariant 3); corrections are `doc_type=RETURN` documents with `original_invoice_id`; RETURNs have their own gapless series |
| Bill activity log, retained and exportable | `audit_log` (append-only, `REVOKE UPDATE, DELETE` from the app role) + `platform_audit_log` when the portal lands |
| PAN/VAT on the shop and every tax invoice | `tenant.pan_vat_no`, `tenant.vat_registered`; on the payload snapshot as `seller_pan` |
| 13% VAT with taxable/non-taxable item flags | `item.is_vat_applicable` per item; VAT = 13% of VAT-applicable lines' taxable amount, only when `is_vat_bill` AND the tenant is VAT-registered |
| "Tax Invoice" wording per bill type | Presentation layer (frontend/print); invoice fields are all present |

### Required invoice fields (payload snapshot content)

Per completed document, `cbms_sync_log.payload` freezes: seller PAN,
formatted invoice number (`PREFIX-FY-NNNNNN`), doc_type, original invoice
reference (credit notes), BS business date and fiscal year, VAT-bill flag,
customer name (customer PAN is NOT modeled yet — see deferrals), per-line
SKU/name/qty/unit price/discount/line total, and subtotal/discount/taxable/
VAT/total/paid/due. **Re-verify this list against the current IRD
specification before go-live.**

## 2. VAT registers

`GET /api/v1/reports/vat-register/sales` and `.../purchase` (apps/reports):
per VAT bill — number, BS date, party name and PAN, taxable, VAT, total,
with a totals row. Sales register lists credit notes as their own rows
(doc_type RETURN) since the IRD expects them visible. Purchase register
uses `supplier.pan_no`. Exact IRD register layouts to be confirmed with the
CA (column order, buyer PAN rules, zero-rated vs exempt handling).

## 3. CBMS sync design

- **Queue**: `cbms_sync_log` — one row per fiscal document (UNIQUE
  tenant+invoice; enqueue is idempotent). Created inside the SAME
  transaction that completes the document (explicit `enqueue_for_sync`
  call in `finalize_invoice` / `_create_return_invoice`; never a signal).
  The payload snapshot is frozen at completion and never rewritten.
- **States**: PENDING → SYNCED (synced_at set) or FAILED (last_error set).
  Only status/attempts/last_error/synced_at are mutable; the migration
  REVOKEs DELETE (documented on the model).
- **Retry**: Celery task `sync_cbms_invoice`, exponential backoff
  (30s × 2^n), max 5 attempts, then FAILED. A worker racing the enqueue's
  commit is treated as retryable; duplicate deliveries skip non-PENDING
  rows.
- **Visibility**: `GET /api/v1/compliance/status/<invoice_id>` (per bill,
  for the billing UI) and `GET /api/v1/compliance/failures` (ops list with
  payloads, gated on `compliance.view`).
- **Provider**: vendor-neutral `CbmsClient` contract behind
  `CBMS_PROVIDER`. Default `local` (no network). The `cbms` HTTP client is
  an explicit `NotImplementedError` stub — **do not enable live sync until
  the IRD's current technical spec (endpoints, auth, field formats,
  materialized-view-log requirements) is verified with a CA/IRD.**

## 4. Open items before go-live (checklist)

- [ ] Verify the exact CBMS payload schema against the current IRD spec.
- [ ] Customer PAN capture (not modeled; register column is null today).
- [ ] "Tax Invoice" / "Abbreviated Tax Invoice" print wording per bill type.
- [ ] IRD approval of the computerized billing system for VAT-registered shops.
- [ ] Materialized view log export format confirmation.
- [ ] Manual re-queue action for FAILED rows (ops UI) — list exists, retry action is a later slice.
