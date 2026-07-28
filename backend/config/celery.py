"""Celery application — reports, SMS, rollups, IRD sync."""

import os

from celery import Celery

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.dev")

app = Celery("dokan")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()
