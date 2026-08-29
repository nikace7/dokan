"""Serializers for the storefront — explicit fields, never ModelSerializer

shortcuts on catalog models: accidentally exposing ``avg_cost`` or reorder
levels here would leak shop secrets to anonymous traffic (invariant 10).
"""

from decimal import Decimal
from typing import Any

from rest_framework import serializers

from apps.catalog.models import Item
from apps.storefront import selectors
from apps.storefront.models import CURRENCY_CHOICES, StoreSettings


class PublicProductSerializer(serializers.Serializer):
    """Public grid row. Display-currency conversion and the store-wide offer
    are applied here from the view's context (``display_currency``,
    ``tenant_currency``, ``discount_pct``) so money math stays server-side.
    """

    id = serializers.UUIDField()
    code = serializers.CharField()
    name = serializers.CharField()
    name_np = serializers.CharField(allow_null=True)
    image = serializers.SerializerMethodField()
    category = serializers.CharField(source="category.name", default=None, allow_null=True)
    brand = serializers.CharField(source="brand.name", default=None, allow_null=True)
    price_min = serializers.SerializerMethodField()
    price_max = serializers.SerializerMethodField()
    website_price = serializers.SerializerMethodField()
    website_compare_at = serializers.SerializerMethodField()
    in_stock = serializers.BooleanField()

    def get_image(self, obj: Item) -> str | None:
        """Same-origin media path — the shopfront host proxies /media/ like POS hosts."""
        return obj.image.url if obj.image else None

    def _display(self, amount: Decimal | None) -> str | None:
        if amount is None:
            return None
        converted = selectors.convert_for_display(
            amount,
            from_currency=self.context["tenant_currency"],
            to_currency=self.context["display_currency"],
        )
        return str(converted)

    def get_price_min(self, obj: Item) -> str | None:
        return self._display(obj.min_selling_price)

    def get_price_max(self, obj: Item) -> str | None:
        return self._display(obj.max_selling_price)

    def get_website_price(self, obj: Item) -> str | None:
        price, _ = selectors.website_price_display(
            obj, discount_pct=self.context.get("discount_pct")
        )
        return str(price) if price is not None else None

    def get_website_compare_at(self, obj: Item) -> str | None:
        _, compare_at = selectors.website_price_display(
            obj, discount_pct=self.context.get("discount_pct")
        )
        return str(compare_at) if compare_at is not None else None


class StoreSettingsSerializer(serializers.Serializer):
    """Tenant-admin payload for GET/PATCH /storefront/settings."""

    hero_title = serializers.CharField(required=False, allow_blank=True, default="")
    hero_subtitle = serializers.CharField(required=False, allow_blank=True, default="")
    announcement = serializers.CharField(required=False, allow_blank=True, default="")
    offer_text = serializers.CharField(required=False, allow_blank=True, default="")
    offer_discount_pct = serializers.DecimalField(
        max_digits=5, decimal_places=2, required=False, allow_null=True, default=None
    )
    currency = serializers.ChoiceField(choices=CURRENCY_CHOICES, required=False)

    def to_representation(self, instance: StoreSettings) -> dict[str, Any]:
        return {
            "hero_title": instance.hero_title,
            "hero_subtitle": instance.hero_subtitle,
            "announcement": instance.announcement,
            "offer_text": instance.offer_text,
            "offer_discount_pct": (
                str(instance.offer_discount_pct)
                if instance.offer_discount_pct is not None
                else None
            ),
            "currency": instance.currency,
        }
