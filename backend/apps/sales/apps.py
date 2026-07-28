"""App config for the sales app (invoice, return, exchange, held bill)."""

from django.apps import AppConfig


class SalesConfig(AppConfig):
    """Registers the sales app."""

    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.sales"
    label = "sales"
