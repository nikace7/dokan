"""App config for the catalog app (category, brand, item, variant, size chart)."""

from django.apps import AppConfig


class CatalogConfig(AppConfig):
    """Registers the catalog app."""

    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.catalog"
    label = "catalog"
