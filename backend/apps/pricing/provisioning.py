"""Pricing defaults required before a newly provisioned shop can bill."""

from typing import TYPE_CHECKING

from apps.pricing.models import RateType

if TYPE_CHECKING:
    from apps.tenants.models import Tenant


def provision_default_rate_type(tenant: "Tenant") -> RateType:
    return RateType.objects.create(
        tenant=tenant,
        code="RETAIL",
        name="Retail",
        is_default=True,
        sort_order=0,
    )
