"""Reject privileged secrets in containers outside their trust boundary."""

from __future__ import annotations

import json
import sys
from collections.abc import Mapping

PRIVILEGED_DATABASE = {
    "POSTGRES_PASSWORD",
    "DOKAN_APP_PASSWORD",
    "DOKAN_MIGRATOR_PASSWORD",
    "DOKAN_MONITOR_PASSWORD",
}
BACKUP_CREDENTIALS = {"AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"}
CONTROL_PLANE = {"CLOUDFLARE_API_TOKEN", "GRAFANA_ADMIN_PASSWORD"}
APPLICATION_SECRETS = {
    "DJANGO_SECRET_KEY",
    "DATABASE_PASSWORD",
    "EMAIL_HOST_PASSWORD",
    "SENTRY_DSN",
}
SENSITIVE_VARIABLES = (
    PRIVILEGED_DATABASE | BACKUP_CREDENTIALS | CONTROL_PLANE | APPLICATION_SECRETS
)

ALLOWED_SECRETS_BY_SERVICE = {
    "backend": APPLICATION_SECRETS,
    "celery": APPLICATION_SECRETS,
    "celery-beat": {"DJANGO_SECRET_KEY", "DATABASE_PASSWORD", "SENTRY_DSN"},
    "pgbouncer": {"DATABASE_PASSWORD"},
    "caddy": {"CLOUDFLARE_API_TOKEN"},
    "migrate": APPLICATION_SECRETS,
    "seed-demo": APPLICATION_SECRETS,
}

REQUIRED_BY_SERVICE = {
    "backend": {"DJANGO_SECRET_KEY", "DATABASE_PASSWORD"},
    "celery": {"DJANGO_SECRET_KEY", "DATABASE_PASSWORD"},
    "celery-beat": {"DJANGO_SECRET_KEY", "DATABASE_PASSWORD"},
    "pgbouncer": {"DATABASE_PASSWORD"},
    "caddy": {"ROOT_DOMAIN"},
    "migrate": {"DJANGO_SECRET_KEY", "DATABASE_PASSWORD"},
    "seed-demo": {"DJANGO_SECRET_KEY", "DATABASE_PASSWORD"},
}


def environment_names(service: Mapping[str, object]) -> set[str]:
    """Return environment keys from Compose's rendered map or list form."""
    environment = service.get("environment", {})
    if isinstance(environment, Mapping):
        return {str(name) for name in environment}
    if isinstance(environment, list):
        return {str(entry).split("=", 1)[0] for entry in environment}
    raise TypeError("Compose service environment must be a map or list")


def main() -> int:
    """Read rendered Compose JSON on stdin and enforce least privilege."""
    document = json.load(sys.stdin)
    services = document.get("services", {})
    failures: list[str] = []

    for service_name, allowed_secrets in ALLOWED_SECRETS_BY_SERVICE.items():
        service = services.get(service_name)
        if not isinstance(service, Mapping):
            failures.append(
                f"{service_name} is missing from the rendered Compose model"
            )
            continue
        names = environment_names(service)
        leaked = sorted((names & SENSITIVE_VARIABLES) - allowed_secrets)
        missing = sorted(REQUIRED_BY_SERVICE[service_name] - names)
        if leaked:
            failures.append(
                f"{service_name} receives forbidden variables: {', '.join(leaked)}"
            )
        if missing:
            failures.append(
                f"{service_name} is missing required variables: {', '.join(missing)}"
            )

    if failures:
        print("Compose secret-boundary policy failed:", file=sys.stderr)
        for failure in failures:
            print(f"- {failure}", file=sys.stderr)
        return 1

    print("Compose secret-boundary policy passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
