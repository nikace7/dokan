"""App config for the compliance app (IRD/CBMS sync)."""

from django.apps import AppConfig


class ComplianceConfig(AppConfig):
    """Registers the compliance app."""

    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.compliance"
    label = "compliance"
