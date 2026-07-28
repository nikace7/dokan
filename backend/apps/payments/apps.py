"""App config for the payments app (payment, gateways, cash session)."""

from django.apps import AppConfig


class PaymentsConfig(AppConfig):
    """Registers the payments app."""

    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.payments"
    label = "payments"
