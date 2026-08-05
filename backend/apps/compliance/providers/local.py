"""No-network CBMS client — the default for local dev and tests.

"Records" each would-be payload onto the module-level SUBMITTED_PAYLOADS
list (test/dev introspection only) and returns a local reference, so the
queue flows end-to-end with zero network. Tests clear the list between
cases.
"""

import uuid
from collections.abc import Mapping
from typing import Any

from apps.compliance.providers.base import CbmsProviderError

#: Introspection sink for the local provider (tests clear between cases).
SUBMITTED_PAYLOADS: list[Mapping[str, Any]] = []


class LocalCbmsClient:
    """Accept payloads without any network call and report success."""

    name = "local"

    def submit_invoice(self, payload: Mapping[str, Any]) -> str:
        if not payload.get("invoice_no"):
            raise CbmsProviderError("payload has no invoice_no", retryable=False)
        SUBMITTED_PAYLOADS.append(payload)
        return f"local-{uuid.uuid4()}"
