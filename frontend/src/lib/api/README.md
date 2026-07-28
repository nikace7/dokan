# `src/lib/api` — API client

## Rule: no hand-written endpoint types

The typed API client is **generated from the backend's OpenAPI 3.1 schema**
(docs/SYSTEM_DESIGN.md §8.4). Hand-writing request/response types for
endpoints is forbidden — they drift from the DRF serializers and lie.

- `client.ts` (this directory) is the **transport layer**: base URL, auth
  header, credentials, error envelope, mandatory `Idempotency-Key` handling.
  It is hand-written and stable.
- `schema.d.ts` is **generated** by:

  ```sh
  npm run api:gen   # openapi-typescript http://localhost:8000/api/schema/ -o src/lib/api/schema.d.ts
  ```

  Regenerate it whenever the backend schema changes. Never edit it by hand
  (it is excluded from linting for that reason).

- Feature code uses the generated types plus `apiRequest`; it never declares
  its own copies of API shapes.

Until the backend schema endpoint exists, `schema.d.ts` is intentionally
absent and features use `apiRequest<unknown>` with local narrowing.
