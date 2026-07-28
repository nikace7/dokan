"""App config for the tenants app (tenant, plan, subscription, provisioning)."""

from django.apps import AppConfig


class TenantsConfig(AppConfig):
    """Registers the tenants app."""

    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.tenants"
    label = "tenants"
