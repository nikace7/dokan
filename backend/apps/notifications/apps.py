"""App config for the notifications app (SMS, email, templates)."""

from django.apps import AppConfig


class NotificationsConfig(AppConfig):
    """Registers the notifications app."""

    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.notifications"
    label = "notifications"
