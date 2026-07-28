"""App config for the pricing app (rate_type, item_price, resolution engine)."""

from django.apps import AppConfig


class PricingConfig(AppConfig):
    """Registers the pricing app."""

    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.pricing"
    label = "pricing"
