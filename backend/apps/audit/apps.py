"""App config for the audit app (audit log)."""

from django.apps import AppConfig


class AuditConfig(AppConfig):
    """Registers the audit app."""

    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.audit"
    label = "audit"
