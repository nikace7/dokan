"""Base settings shared by every environment.

Everything environment-specific is read from ``os.environ``. Production
secrets are asserted at startup by ``config.settings.prod`` — the process
fails loudly instead of booting with a default secret.
"""

from __future__ import annotations

import os
from datetime import timedelta
from pathlib import Path

from celery.schedules import crontab

BASE_DIR = Path(__file__).resolve().parent.parent.parent


def env(name: str, default: str | None = None) -> str | None:
    """Read an environment variable, returning ``default`` when unset."""
    return os.environ.get(name, default)


def env_list(name: str, default: str = "") -> list[str]:
    """Read a comma-separated environment variable into a list."""
    raw = env(name, default) or ""
    return [part.strip() for part in raw.split(",") if part.strip()]


# The secrets every deployment must provide. prod.py asserts they exist.
REQUIRED_SECRETS = (
    "DJANGO_SECRET_KEY",
    "DATABASE_NAME",
    "DATABASE_USER",
    "DATABASE_PASSWORD",
)


def assert_required_secrets() -> None:
    """Fail at startup if any required secret env var is missing."""
    missing = [name for name in REQUIRED_SECRETS if not env(name)]
    if missing:
        msg = f"Missing required environment secrets: {', '.join(missing)}"
        raise RuntimeError(msg)


# ---------------------------------------------------------------------------
# Core Django
# ---------------------------------------------------------------------------
SECRET_KEY = env("DJANGO_SECRET_KEY", "dev-only-insecure-secret-key-change-me")
DEBUG = False
ALLOWED_HOSTS = env_list("ALLOWED_HOSTS", "*")

# Tenancy: every tenant is served from <slug>.<ROOT_DOMAIN>.
ROOT_DOMAIN = env("ROOT_DOMAIN", "dokan.com.np")
# Empty means the admin API fails closed until explicit IPs/CIDRs are set.
PLATFORM_ADMIN_ALLOWED_IPS = env_list("PLATFORM_ADMIN_ALLOWED_IPS")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "rest_framework_simplejwt.token_blacklist",
    "drf_spectacular",
    # Platform spine.
    "core",
    # Business apps.
    "apps.tenants",
    "apps.platformadmin",
    "apps.accounts",
    "apps.catalog",
    "apps.pricing",
    "apps.inventory",
    "apps.purchasing",
    "apps.sales",
    "apps.customers",
    "apps.payments",
    "apps.expenses",
    "apps.reports",
    "apps.audit",
    "apps.notifications",
    "apps.compliance",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "core.middleware.platform_admin.PlatformAdminBoundaryMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    # Tenancy: resolves the tenant from the subdomain and runs
    # SET LOCAL app.tenant_id inside the request transaction. Must run
    # before any ORM access.
    "core.middleware.tenant.TenantMiddleware",
    # Feature gating runs after tenant resolution but before authentication
    # and route permissions.
    "core.middleware.plan_gate.PlanGateMiddleware",
    # Explicit service-layer audit writes inherit IP, user agent, and any
    # signed support-session actor claim from the current request.
    "core.middleware.audit.AuditContextMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

# ---------------------------------------------------------------------------
# Database — PostgreSQL 16. ATOMIC_REQUESTS gives the request transaction
# that SET LOCAL app.tenant_id depends on (see core/middleware/tenant.py).
# ---------------------------------------------------------------------------
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": env("DATABASE_NAME", "dokan"),
        "USER": env("DATABASE_USER", "dokan_app"),
        "PASSWORD": env("DATABASE_PASSWORD", ""),
        "HOST": env("DATABASE_HOST", "localhost"),
        "PORT": env("DATABASE_PORT", "5432"),
        "ATOMIC_REQUESTS": True,
        "CONN_MAX_AGE": 60,
    }
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# ---------------------------------------------------------------------------
# Cache — Redis. Used for tenant lookup, permission cache, rate limits.
# ---------------------------------------------------------------------------
REDIS_URL = env("REDIS_URL", "redis://localhost:6379/0")

CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.redis.RedisCache",
        "LOCATION": REDIS_URL,
    }
}

# ---------------------------------------------------------------------------
# Celery
# ---------------------------------------------------------------------------
CELERY_BROKER_URL = env("CELERY_BROKER_URL", "redis://localhost:6379/1")
CELERY_RESULT_BACKEND = env("CELERY_RESULT_BACKEND", "redis://localhost:6379/2")
CELERY_TASK_TIME_LIMIT = 300
CELERY_TASK_TRACK_STARTED = True

# CBMS sync provider: "local" (no network, default) or "cbms" (live IRD —
# verify requirements with a Nepali CA/IRD before enabling, design §1185).
CBMS_PROVIDER = env("CBMS_PROVIDER", "local")
CELERY_WORKER_SEND_TASK_EVENTS = True
CELERY_BEAT_SCHEDULE = {
    "tenants-reconcile-usage-nightly": {
        "task": "apps.tenants.tasks.reconcile_usage_snapshots",
        "schedule": crontab(hour=0, minute=15),
    }
}

# ADR 0004. "log" is the no-network local/staging adapter; production must
# select a real adapter when SMS is enabled there.
SMS_PROVIDER = env("SMS_PROVIDER", "log")

# ---------------------------------------------------------------------------
# Internationalization — code is English; the UI is bilingual Nepali/English.
# ---------------------------------------------------------------------------
LANGUAGE_CODE = "en"
TIME_ZONE = "Asia/Kathmandu"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

# Uploaded media (item images). Written by the backend onto the ``media``
# volume, served by Caddy at MEDIA_URL (mirrors the staticfiles pattern);
# in local dev Django's static() helper serves it when DEBUG is on.
MEDIA_URL = "/media/"
MEDIA_ROOT = Path(env("MEDIA_ROOT", str(BASE_DIR / "media")) or str(BASE_DIR / "media"))

# Tenant-scoped custom user model (phone login). Platform staff live in
# apps.platformadmin.PlatformUser — a separate table and token audience.
AUTH_USER_MODEL = "accounts.User"

# Phone is unique PER TENANT (UNIQUE(tenant_id, phone)), not globally —
# two shops may both have a "Ram" with the same number idea, and global
# uniqueness would leak which shops a phone belongs to.
SILENCED_SYSTEM_CHECKS = ["auth.E003"]

# ---------------------------------------------------------------------------
# DRF / OpenAPI / JWT
# ---------------------------------------------------------------------------
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ("apps.accounts.authentication.TenantJWTAuthentication",),
    "DEFAULT_PERMISSION_CLASSES": ("rest_framework.permissions.IsAuthenticated",),
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_RENDERER_CLASSES": ("rest_framework.renderers.JSONRenderer",),
    "EXCEPTION_HANDLER": "core.exceptions.api_exception_handler",
}

# Token lifetimes per docs/SYSTEM_DESIGN.md §8.4: access 30 min, refresh 30
# days, rotating.
SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=30),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=30),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "UPDATE_LAST_LOGIN": True,
    "ALGORITHM": "HS256",
}

SPECTACULAR_SETTINGS = {
    "TITLE": "Dokan API",
    "DESCRIPTION": "Multi-tenant clothing shop management API (see docs/SYSTEM_DESIGN.md).",
    "VERSION": "0.1.0",
    "SERVE_INCLUDE_SCHEMA": False,
}
