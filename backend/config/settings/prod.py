"""Production settings — asserts every required secret exists at startup."""

from pathlib import Path

from config.settings.base import *  # noqa: F403
from config.settings.base import (
    assert_production_email_backend,
    assert_required_secrets,
    assert_transaction_pooling,
    env,
    env_list,
)

assert_required_secrets()
assert_production_email_backend(EMAIL_BACKEND)  # noqa: F405
assert_transaction_pooling(env("DATABASE_POOL_MODE"))

DEBUG = False
ALLOWED_HOSTS = env_list("ALLOWED_HOSTS")

SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_SSL_REDIRECT = True
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_HSTS_SECONDS = 31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_CONTENT_TYPE_NOSNIFF = True

# Media volume path on the VPS (compose overrides via the MEDIA_ROOT env var
# to the mounted volume path when running in Docker).
MEDIA_ROOT = Path(env("MEDIA_ROOT", "/srv/media") or "/srv/media")
