"""App config for the customers app (customer, loyalty, party ledger)."""

from django.apps import AppConfig


class CustomersConfig(AppConfig):
    """Registers the customers app."""

    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.customers"
    label = "customers"
