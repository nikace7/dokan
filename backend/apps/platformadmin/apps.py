"""App config for the platformadmin app (super admin API, impersonation)."""

from django.apps import AppConfig


class PlatformadminConfig(AppConfig):
    """Registers the platformadmin app."""

    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.platformadmin"
    label = "platformadmin"
