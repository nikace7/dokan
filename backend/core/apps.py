"""App config for the platform spine."""

from django.apps import AppConfig


class CoreConfig(AppConfig):
    """Registers the core (spine) app. Holds only abstract models and helpers."""

    default_auto_field = "django.db.models.BigAutoField"
    name = "core"
