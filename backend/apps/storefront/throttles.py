"""Rate limits for storefront endpoints."""

from rest_framework.throttling import AnonRateThrottle


class StorefrontThrottle(AnonRateThrottle):
    """Public catalog browsing — generous for shoppers, bounded against scraping."""

    scope = "storefront"
    rate = "120/min"
