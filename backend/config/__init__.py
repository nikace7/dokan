"""Project configuration package."""

# Make sure the Celery app is imported whenever Django starts so that
# @shared_task decorators bind to it.
from config.celery import app as celery_app

__all__ = ("celery_app",)
