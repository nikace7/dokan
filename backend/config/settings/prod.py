"""Production settings — asserts every required secret exists at startup."""

from config.settings.base import *  # noqa: F403
from config.settings.base import assert_required_secrets, env_list

assert_required_secrets()

DEBUG = False
ALLOWED_HOSTS = env_list("ALLOWED_HOSTS")

SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_SSL_REDIRECT = True
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_HSTS_SECONDS = 31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_CONTENT_TYPE_NOSNIFF = True
