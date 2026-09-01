# API contract

The reviewable OpenAPI 3.1 source of truth is
[`openapi/schema.yaml`](../openapi/schema.yaml). Django generates it from DRF
views and serializers; the tenant/admin frontend generates
`frontend/src/lib/api/schema.d.ts` from that document. Neither generated file
is hand-edited.

```bash
cd backend
python manage.py spectacular --file ../openapi/schema.yaml --validate

cd ../frontend
npm run api:gen       # regenerate TypeScript declarations
npm run api:check     # fail if the committed declarations drift
```

CI regenerates both files and fails when either diff is non-empty. Every API
operation must have a unique `operationId`, a typed request/response contract,
and the default `ErrorEnvelope` response.

## Hosts and authentication

- Tenant API: `https://<slug>.mero-pasal.online/api/v1`. A tenant JWT has
  `aud=tenant` and a `tenant` claim matching the subdomain-resolved tenant.
- Platform API: `https://admin.mero-pasal.online/api/v1/admin`. A platform JWT
  has `aud=platform`; the admin host and configured IP allowlist are also
  mandatory.
- Public storefront API: `https://<subdomain>.shop.mero-pasal.online/api/v1/storefront`.
  Catalog and shared-bill reads are anonymous. Customer order history uses the
  storefront OTP token realm.

Tokens never cross realms. Tenant identity is never accepted from a request
header, body, or query parameter.

### Tenant account security

- `POST /auth/token` accepts phone, password, a stable browser `device_id`, and
  a human-readable `device_name`. When optional login OTP is enabled it first
  returns HTTP 428 `OTP_REQUIRED` with `details.challenge_id`; repeat the same
  request with that challenge id and the six-digit `otp`.
- Access and refresh tokens carry `sid` and are valid only while that
  RLS-protected registered-device session is active. `POST /auth/logout`,
  `POST /auth/sessions/<id>/revoke`, and
  `POST /auth/sessions/revoke-others` take effect immediately.
- `POST /auth/password-reset/request` always returns the same HTTP 202 response
  to prevent account enumeration. The SMS code is stored only as an HMAC hash,
  expires after ten minutes, and locks after five incorrect attempts.
  `POST /auth/password-reset/confirm` revokes every device.
- `POST /auth/password/change` preserves the current device and revokes the
  rest. `POST /auth/login-otp/request|confirm` enables optional SMS login
  verification; `DELETE /auth/login-otp` disables it after password proof.
  Security OTP delivery bypasses subscription SMS quotas so account recovery
  cannot be locked behind a plan limit.

## Envelopes

Success responses use one shape:

```json
{"data": {}, "meta": null, "error": null}
```

Paginated responses populate `meta` with `count`, `page`, `page_size`, and
`total_pages`. Error responses use:

```json
{
  "data": null,
  "error": {
    "code": "PRICE_BELOW_MIN",
    "message": "The selling price is below the allowed minimum.",
    "field": "unit_price",
    "details": {}
  }
}
```

`code` is stable and machine-readable. `message` is for people and may change
or be translated. Clients must not parse messages.

## Error codes

`backend/core/error_codes.py` is the canonical catalog and OpenAPI publishes it
as `ApiErrorCode`. A contract test scans production Python source and rejects
literal codes missing from the catalog. The full current catalog is:

| Area | Codes |
|---|---|
| Authentication and realm | `ACCOUNT_LOCKED`, `AUTHENTICATION_FAILED`, `CURRENT_PASSWORD_INVALID`, `IMPERSONATION_ACTION_BLOCKED`, `IMPERSONATION_DURATION_INVALID`, `IMPERSONATION_ENDED`, `IMPERSONATION_END_FORBIDDEN`, `IMPERSONATION_READ_ONLY`, `IMPERSONATION_REASON_INVALID`, `IMPERSONATION_SCOPE_INVALID`, `IMPERSONATION_TARGET_NOT_FOUND`, `IMPERSONATION_WRITE_FORBIDDEN`, `INVALID_CREDENTIALS`, `LOGIN_REQUIRED`, `NOT_AUTHENTICATED`, `NO_ACTIVE_ACCOUNT`, `OTP_INVALID`, `OTP_LOCKED`, `OTP_REQUIRED`, `OWNER_NOTIFICATION_UNAVAILABLE`, `PASSWORD_INVALID`, `PLATFORM_HOST_REQUIRED`, `PLATFORM_IP_FORBIDDEN`, `REALM_MISMATCH`, `SESSION_NOT_FOUND`, `SESSION_REVOKED`, `SUPPORT_SESSION_REQUIRED`, `TENANT_REQUIRED`, `TOKEN_NOT_VALID`, `TOKEN_TENANT_MISMATCH`, `TWO_FACTOR_NOT_CONFIGURED` |
| Validation and generic HTTP | `ALREADY_EXISTS`, `AMOUNT_INVALID`, `DATE_INVALID`, `DATE_RANGE_INCOMPLETE`, `DATE_RANGE_INVALID`, `FILTER_INVALID`, `FLOAT_INVALID`, `LINK_INVALID`, `NOT_FOUND`, `PARAM_INVALID`, `PERMISSION_DENIED`, `QTY_INVALID`, `REASON_REQUIRED`, `SCOPE_INVALID`, `SCOPE_TARGET_REQUIRED`, `TARGET_INVALID`, `THROTTLED`, `VALIDATION_ERROR` |
| Plans, tenancy, and RBAC | `FEATURE_OVERRIDE_INVALID`, `INVALID_PERMISSIONS`, `INVALID_ROLE_CODE`, `LAST_OWNER_ROLE`, `PERMISSION_CATALOG_INCOMPLETE`, `PERMISSION_NOT_FOUND`, `PLAN_CONFIGURATION_ERROR`, `PLAN_CONFIGURATION_INVALID`, `PLAN_FEATURE_REQUIRED`, `PLAN_INACTIVE`, `PLAN_LIMIT_REACHED`, `PLATFORM_ROLE_FORBIDDEN`, `ROLE_IN_USE`, `SUBSCRIPTION_AMOUNT_INVALID`, `SUBSCRIPTION_PAID_TERMINAL`, `SUBSCRIPTION_PERIOD_INVALID`, `SYSTEM_ROLE`, `TENANT_INVALID`, `TRIAL_END_REQUIRED` |
| Catalog and pricing | `BARCODE_INVALID`, `BRAND_NOT_FOUND`, `CATEGORY_CYCLE`, `CATEGORY_NOT_FOUND`, `COST_INVALID`, `COST_VISIBILITY_REQUIRED`, `DISCOUNT_INVALID`, `DISCOUNT_OUT_OF_RANGE`, `IMAGE_REQUIRED`, `IMAGE_TOO_LARGE`, `IMAGE_TYPE_UNSUPPORTED`, `ITEM_NOT_FOUND`, `ITEM_REQUIRED`, `LOOKUP_PARAM_REQUIRED`, `MATRIX_EMPTY`, `OVERRIDE_REASON_REQUIRED`, `PRICE_ABOVE_MAX`, `PRICE_BELOW_MIN`, `PRICE_BOUNDS_INVALID`, `PRICE_INVALID`, `PRICE_NOT_SET`, `PRICING_RATE_FORBIDDEN`, `PRODUCT_NOT_FOUND`, `QUANTITY_KEY_INVALID`, `RATE_TYPE_IN_USE`, `RATE_TYPE_NOT_FOUND`, `SIZE_CHART_EMPTY`, `SIZE_CHART_NOT_FOUND`, `VARIANT_NOT_FOUND`, `VARIANT_REQUIRED` |
| Inventory and purchasing | `BRANCH_NOT_FOUND`, `BRANCH_REQUIRED`, `COUNT_ALREADY_OPEN`, `COUNT_EMPTY_BRANCH`, `COUNT_INCOMPLETE`, `COUNT_INVALID`, `COUNT_NOT_FOUND`, `COUNT_QTY_INVALID`, `COUNT_STATE_INVALID`, `COUNT_VARIANT_UNKNOWN`, `FROM_BRANCH_NOT_FOUND`, `OVER_RECEIVE`, `PURCHASE_INVOICE_NOT_FOUND`, `STOCK_INSUFFICIENT`, `SUPPLIER_NOT_FOUND`, `TO_BRANCH_NOT_FOUND`, `TRANSFER_LINE_UNKNOWN`, `TRANSFER_NOT_FOUND`, `TRANSFER_SAME_BRANCH`, `TRANSFER_STATE_INVALID` |
| Sales, returns, and sharing | `BILL_NOT_FOUND`, `CREDIT_LIMIT_EXCEEDED`, `CREDIT_TENDER_MISMATCH`, `CUSTOMER_NOT_FOUND`, `IDEMPOTENCY_KEY_REQUIRED`, `IDEMPOTENCY_KEY_REUSED`, `INVOICE_NOT_EDITABLE`, `INVOICE_NOT_FOUND`, `INVOICE_NOT_SHAREABLE`, `INVOICE_NO_INVALID`, `LINES_REQUIRED`, `MISSING_IDEMPOTENCY_KEY`, `OUT_OF_STOCK`, `OVER_RETURN`, `RECEIPT_NOT_PRINTABLE`, `REFUND_AMOUNT_INVALID`, `REFUND_EXCEEDS_CREDIT`, `REFUND_METHOD_INVALID`, `RETURN_LINE_NOT_INVOICED`, `RETURN_NOT_ALLOWED`, `UDHARO_REQUIRES_CUSTOMER` |
| Payments and cash sessions | `ALLOCATION_AMOUNT_INVALID`, `ALLOCATION_EXCEEDS_AMOUNT`, `ALLOCATION_EXCEEDS_OUTSTANDING`, `ALLOCATION_INVOICE_INVALID`, `CASH_SESSION_NOT_FOUND`, `CASH_SESSION_REQUIRED`, `CREDIT_NOTE_EXCEEDS_DUES`, `CREDIT_NOTE_WITHOUT_CUSTOMER`, `OVERPAYMENT`, `PAYMENT_ALREADY_REVERSED`, `PAYMENT_AMOUNT_INVALID`, `PAYMENT_METHOD_INVALID`, `PAYMENT_NOT_FOUND`, `REVERSAL_REASON_REQUIRED`, `SESSION_ALREADY_CLOSED`, `SESSION_ALREADY_OPEN` |
| Storefront | `BANNERS_INVALID`, `ORDER_NOT_FOUND`, `OTP_INVALID`, `OTP_LOCKED`, `OTP_RESEND_TOO_SOON`, `SHOPFRONT_INACTIVE`, `SHOPFRONT_INVALID`, `SHOPFRONT_NOT_FOUND`, `SHOPFRONT_TAKEN`, `SHOP_NOT_READY` |
| Compliance and notifications | `CBMS_DOC_TYPE_INVALID`, `CBMS_NOT_COMPLETED`, `SMS_PHONE_INVALID`, `SMS_RECEIPT_NOT_ALLOWED`, `SMS_TEMPLATE_CONTEXT_INVALID`, `SMS_TEMPLATE_INVALID` |
| Expenses and customer credit | `CUSTOMER_CREDIT_PERMISSION_REQUIRED`, `EXPENSE_NOT_FOUND`, `GROUP_BY_INVALID` |

Dynamic resource lookups use `core.responses.not_found_code()` so a label such
as `Purchase invoice` always becomes `PURCHASE_INVOICE_NOT_FOUND`, never a code
containing spaces.

## Idempotency

`Idempotency-Key` is a required, non-empty header on sale creation/hold,
returns, exchanges, payment receipts, supplier payments, payment reversals, and
storefront order placement. Keys are scoped to the owning tenant/customer
contract. A replay with the same payload returns the original resource; reuse
with a different payload returns `IDEMPOTENCY_KEY_REUSED` (storefront currently
uses `MISSING_IDEMPOTENCY_KEY` for a missing key).

## Rate limits

- Auth endpoints: 60 requests/minute per tenant-aware caller/IP.
- Authenticated tenant API: 300 requests/minute per tenant and user.
- Reports: 20 requests/minute per tenant and user.
- Platform and public storefront endpoints may apply stricter endpoint-specific
  limits shown in the generated OpenAPI descriptions.

Throttled requests return HTTP 429 and the standard error envelope.

## Versioning and deprecation

The current major contract is `/api/v1`. Additive fields and endpoints may ship
within v1. Removing or changing the meaning/type of a field requires a new
major path. A deprecated operation or field is first marked `deprecated` in
OpenAPI and retained for at least one minor release; release notes must name its
replacement and removal date.
