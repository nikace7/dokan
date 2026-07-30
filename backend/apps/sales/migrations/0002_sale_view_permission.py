# Generated for feat(sales): seed the sale.view codename.

from typing import TYPE_CHECKING

from django.db import migrations

from core.permissions.catalog import PERMISSIONS

if TYPE_CHECKING:
    from django.apps.registry import Apps
    from django.db.backends.base.schema import BaseDatabaseSchemaEditor

_SALE_CODES = ("sale.view",)


def seed_sale_permissions(apps: "Apps", schema_editor: "BaseDatabaseSchemaEditor") -> None:
    permission_model = apps.get_model("accounts", "Permission")
    for perm in PERMISSIONS:
        if perm.code not in _SALE_CODES:
            continue
        permission_model.objects.update_or_create(
            code=perm.code,
            defaults={"module": perm.module, "name": perm.name, "is_sensitive": perm.sensitive},
        )


def unseed_sale_permissions(apps: "Apps", schema_editor: "BaseDatabaseSchemaEditor") -> None:
    permission_model = apps.get_model("accounts", "Permission")
    permission_model.objects.filter(code__in=_SALE_CODES).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("sales", "0001_initial"),
        ("accounts", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(seed_sale_permissions, unseed_sale_permissions),
    ]
