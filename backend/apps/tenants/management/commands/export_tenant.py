"""Export one tenant's portable data as CSV files in a ZIP archive."""

from __future__ import annotations

import csv
import io
import json
import os
import tempfile
import zipfile
from collections.abc import Iterable
from datetime import date, datetime, time
from decimal import Decimal
from pathlib import Path
from typing import Any
from uuid import UUID

from django.apps import apps
from django.core.management.base import BaseCommand, CommandError, CommandParser
from django.db import connection, models, transaction
from django.utils import timezone

from apps.tenants.models import Tenant
from core.db.rls import set_local_tenant
from core.models import TenantScopedModel

_EXCLUDED_FIELDS = {"password"}


def _tenant_models() -> list[type[models.Model]]:
    return sorted(
        (
            model
            for model in apps.get_models()
            if issubclass(model, TenantScopedModel) and not model._meta.proxy
        ),
        key=lambda model: model._meta.db_table,
    )


def _fields(model: type[models.Model]) -> list[models.Field[Any, Any]]:
    return [field for field in model._meta.concrete_fields if field.name not in _EXCLUDED_FIELDS]


def _value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return str(value).lower()
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, sort_keys=True)
    if isinstance(value, (Decimal, UUID)):
        return str(value)
    return str(value)


def _write_csv(
    archive: zipfile.ZipFile,
    name: str,
    model: type[models.Model],
    rows: Iterable[models.Model],
) -> None:
    fields = _fields(model)
    with (
        archive.open(name, "w") as raw,
        io.TextIOWrapper(raw, encoding="utf-8-sig", newline="") as stream,
    ):
        writer = csv.writer(stream)
        writer.writerow(field.attname for field in fields)
        writer.writerows([_value(getattr(row, field.attname)) for field in fields] for row in rows)


class Command(BaseCommand):
    help = "Export one tenant as a ZIP containing portable UTF-8 CSV files."

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument("slug", help="Immutable tenant subdomain slug.")
        parser.add_argument(
            "--output",
            help="Destination ZIP path (defaults to <slug>-export-<UTC timestamp>.zip).",
        )

    def handle(self, *args: object, **options: object) -> None:
        slug = str(options["slug"]).strip().lower()
        tenant = Tenant.objects.filter(slug=slug).first()
        if tenant is None:
            raise CommandError(f"Tenant not found: {slug}")

        output = self._output_path(slug, options.get("output"))
        if output.exists():
            raise CommandError(f"Output already exists: {output}")
        output.parent.mkdir(parents=True, exist_ok=True)

        temporary = self._temporary_path(output)
        try:
            self._build_archive(temporary, tenant)
            try:
                os.link(temporary, output)
            except FileExistsError as exc:
                raise CommandError(f"Output already exists: {output}") from exc
        finally:
            temporary.unlink(missing_ok=True)

        self.stdout.write(self.style.SUCCESS(f"Exported {slug} to {output}"))

    @staticmethod
    def _output_path(slug: str, requested: object) -> Path:
        if requested:
            return Path(str(requested)).expanduser().resolve()
        stamp = timezone.now().strftime("%Y%m%dT%H%M%SZ")
        return Path.cwd() / f"{slug}-export-{stamp}.zip"

    @staticmethod
    def _temporary_path(output: Path) -> Path:
        handle, name = tempfile.mkstemp(prefix=f".{output.name}.", suffix=".tmp", dir=output.parent)
        os.close(handle)
        return Path(name)

    def _build_archive(self, output: Path, tenant: Tenant) -> None:
        tenant_models = _tenant_models()
        with transaction.atomic():
            set_local_tenant(connection, tenant.pk)
            querysets = {
                model._meta.db_table: model._default_manager.filter(tenant_id=tenant.pk).order_by(
                    model._meta.pk.attname
                )
                for model in tenant_models
            }
            counts = {name: queryset.count() for name, queryset in querysets.items()}
            counts["tenant"] = 1
            manifest = {
                "format_version": 1,
                "generated_at": timezone.now().isoformat(),
                "tenant": tenant.slug,
                "tables": dict(sorted(counts.items())),
            }

            models_by_name = {f"{model._meta.db_table}.csv": model for model in tenant_models}
            names = sorted(["manifest.json", "tenant.csv", *models_by_name])
            with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                for name in names:
                    if name == "manifest.json":
                        archive.writestr(name, json.dumps(manifest, ensure_ascii=False, indent=2))
                    elif name == "tenant.csv":
                        _write_csv(archive, name, Tenant, [tenant])
                    else:
                        model = models_by_name[name]
                        table = model._meta.db_table
                        _write_csv(
                            archive,
                            name,
                            model,
                            querysets[table].iterator(chunk_size=1000),
                        )
