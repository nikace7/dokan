"""App config for the inventory app (stock level, movement, transfer, count)."""

from django.apps import AppConfig


class InventoryConfig(AppConfig):
    """Registers the inventory app."""

    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.inventory"
    label = "inventory"
