"""Per-tenant portable export command tests."""

import csv
import io
import json
import zipfile
from pathlib import Path

import pytest
from django.apps import apps
from django.core.management import call_command
from django.core.management.base import CommandError

from core.models import TenantScopedModel
from tests.factories import BranchFactory, CustomerFactory, TenantFactory, UserFactory

pytestmark = pytest.mark.django_db


def rows(archive: zipfile.ZipFile, name: str) -> list[dict[str, str]]:
    return list(csv.DictReader(io.StringIO(archive.read(name).decode("utf-8-sig"))))


def test_exports_every_tenant_table_without_credentials_or_other_tenants(tmp_path: Path) -> None:
    tenant = TenantFactory(slug="export-shop", name="Export Shop")
    other = TenantFactory(slug="other-shop")
    BranchFactory(tenant=tenant, code="MAIN", name="Main Branch")
    customer = CustomerFactory(tenant=tenant, name="Own Customer")
    CustomerFactory(tenant=other, name="Other Tenant Customer")
    user = UserFactory(tenant=tenant, phone="9800000001")
    output = tmp_path / "export-shop.zip"

    call_command("export_tenant", tenant.slug, output=str(output))

    assert output.exists()
    with zipfile.ZipFile(output) as archive:
        names = archive.namelist()
        expected = {"manifest.json", "tenant.csv"} | {
            f"{model._meta.db_table}.csv"
            for model in apps.get_models()
            if issubclass(model, TenantScopedModel)
        }
        assert names == sorted(expected)
        assert rows(archive, "tenant.csv")[0]["slug"] == str(tenant.slug)
        customer_rows = rows(archive, "customer.csv")
        assert len(customer_rows) == 1
        assert customer_rows[0]["id"] == str(customer.pk)
        assert customer_rows[0]["name"] == "Own Customer"
        user_csv = archive.read("user.csv").decode("utf-8-sig")
        assert "password" not in rows(archive, "user.csv")[0]
        assert str(user.password) not in user_csv
        manifest = json.loads(archive.read("manifest.json"))
        assert manifest["tenant"] == tenant.slug
        assert manifest["tables"]["customer"] == 1


def test_rejects_unknown_tenant_and_existing_output(tmp_path: Path) -> None:
    with pytest.raises(CommandError, match="Tenant not found"):
        call_command("export_tenant", "missing-shop", output=str(tmp_path / "missing.zip"))

    tenant = TenantFactory(slug="existing-export")
    output = tmp_path / "existing.zip"
    output.write_bytes(b"keep me")
    with pytest.raises(CommandError, match="already exists"):
        call_command("export_tenant", tenant.slug, output=str(output))
    assert output.read_bytes() == b"keep me"
