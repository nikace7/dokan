"""App config for the accounts app (user, role, permission, auth)."""

from django.apps import AppConfig


class AccountsConfig(AppConfig):
    """Registers the accounts app."""

    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.accounts"
    label = "accounts"
