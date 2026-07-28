"""App config for the expenses app (expense tracking)."""

from django.apps import AppConfig


class ExpensesConfig(AppConfig):
    """Registers the expenses app."""

    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.expenses"
    label = "expenses"
