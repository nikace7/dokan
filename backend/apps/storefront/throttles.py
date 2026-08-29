"""Rate limits for storefront endpoints."""

from rest_framework.throttling import AnonRateThrottle


class StorefrontThrottle(AnonRateThrottle):
    """Public catalog browsing — generous for shoppers, bounded against scraping."""

    scope = "storefront"
    rate = "120/min"


class StorefrontAuthThrottle(AnonRateThrottle):
    """OTP endpoints — tight: every request can send a real email."""

    scope = "storefront_auth"
    rate = "6/min"
