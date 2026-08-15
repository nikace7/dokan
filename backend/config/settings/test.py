"""Test settings — fast, isolated, never touching real secrets.

PostgreSQL is still the backend (RLS and tenant isolation are Postgres
features); tests that need the database use the ``django_db`` marker and a
dedicated test database on the host/port below.
"""

import tempfile
from pathlib import Path

from config.settings.base import *  # noqa: F403
from config.settings.base import env

DEBUG = False

# Uploaded files land in a per-run temp dir; image tests override this with
# tmp_path so each test asserts against its own empty storage.
MEDIA_ROOT = Path(tempfile.mkdtemp(prefix="dokan-test-media-"))

# Connection is env-overridable so a dedicated local test container
# (e.g. -p 5433:5432) and the CI postgres:16 service both work unchanged.
DATABASES["default"]["NAME"] = env("DATABASE_NAME", "dokan_test")  # noqa: F405
DATABASES["default"]["USER"] = env("DATABASE_USER", "dokan_migrator")  # noqa: F405
DATABASES["default"]["HOST"] = env("DATABASE_HOST", "localhost")  # noqa: F405
DATABASES["default"]["PORT"] = env("DATABASE_PORT", "5432")  # noqa: F405

# Unit tests run without a live Postgres; ATOMIC_REQUESTS would open a
# connection per request. Tenant-scoped integration tests re-enable it with
# override_settings and run against a real database (RLS is a DB feature).
DATABASES["default"]["ATOMIC_REQUESTS"] = False  # noqa: F405

# Faster password hashing in tests.
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]

# Tests do not send real tasks.
CELERY_TASK_ALWAYS_EAGER = True

# LocMem cache so tenant-lookup caching tests don't need a live Redis.
CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
    }
}
