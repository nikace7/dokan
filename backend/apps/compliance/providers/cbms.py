"""Live IRD CBMS HTTP client — STUB, not enabled.

VERIFY WITH A NEPALI CA OR THE IRD BEFORE ENABLING (design §1185): CBMS
field formats, auth, and endpoints change, and the penalty for a wrong
guess lands on the shop. This stub exists so the provider resolver and
settings plumbing are real today and the implementation has exactly one
place to land.
"""

from collections.abc import Mapping
from typing import Any


class CbmsHttpClient:
    """Placeholder for the verified IRD CBMS integration."""

    name = "cbms"

    def submit_invoice(self, payload: Mapping[str, Any]) -> str:
        raise NotImplementedError(
            "CBMS live sync is disabled until IRD/CBMS technical "
            "requirements are verified with a Nepali CA or the IRD. Use the "
            "local provider (CBMS_PROVIDER=local) until then."
        )
