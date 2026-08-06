"""Rate limits for sales endpoints."""

from rest_framework.throttling import AnonRateThrottle


class SharedBillThrottle(AnonRateThrottle):
    """Public share-link reads: unguessable token + a modest anonymous cap."""

    scope = "shared_bill"
    rate = "60/min"
