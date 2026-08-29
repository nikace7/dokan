"""Tenant-owned online-store settings (one row per tenant).

The public storefront (``*.shop.<root>``) reads these to render dynamic
content the shop controls itself: hero copy, an announcement strip, one
store-wide offer with a discount percentage, and the currency website
prices are entered and displayed in. The template and the store address
stay platform-admin decisions (``Tenant.shopfront_template`` /
``shopfront_subdomain``); everything here is tenant-admin territory.
"""

from django.core.validators import MinValueValidator
from django.db import models

from core.models import TenantScopedModel
from core.money import CURRENCY_INR, CURRENCY_NPR

CURRENCY_CHOICES = ((CURRENCY_NPR, "NPR"), (CURRENCY_INR, "INR"))

#: Cap on store-wide offer percentages — a "100% off" shop is a data-entry
#: mistake, not a promotion.
MAX_OFFER_PCT = 90


class StoreSettings(TenantScopedModel):
    """Editable website content + pricing knobs for a tenant's online store."""

    hero_title = models.TextField(blank=True, default="")
    hero_subtitle = models.TextField(blank=True, default="")
    announcement = models.TextField(blank=True, default="")
    offer_text = models.TextField(blank=True, default="")
    offer_discount_pct = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[MinValueValidator(0)],
    )
    #: Currency website prices are entered in and the storefront displays.
    #: May differ from the tenant's counter currency — the public grid then
    #: converts the selling-price range at the NPR/INR peg for display.
    currency = models.CharField(max_length=3, choices=CURRENCY_CHOICES, default=CURRENCY_NPR)

    class Meta:
        db_table = "store_settings"
        constraints = [
            models.UniqueConstraint(fields=["tenant"], name="store_settings_tenant_uniq")
        ]

    def __str__(self) -> str:
        return f"Store settings ({self.tenant_id})"
