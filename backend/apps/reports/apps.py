"""App config for the reports app (selectors + rollup jobs)."""

from django.apps import AppConfig


class ReportsConfig(AppConfig):
    """Registers the reports app."""

    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.reports"
    label = "reports"
