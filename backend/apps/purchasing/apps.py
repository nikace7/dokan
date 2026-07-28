"""App config for the purchasing app (supplier, purchase invoice)."""

from django.apps import AppConfig


class PurchasingConfig(AppConfig):
    """Registers the purchasing app."""

    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.purchasing"
    label = "purchasing"
