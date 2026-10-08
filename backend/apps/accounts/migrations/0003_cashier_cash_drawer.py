"""Let the built-in Cashier role open and close the cash drawer.

A sale needs an open cash session and only ``cash.manage`` can open one, so a
shop whose counter staff are cashiers could not bill once the drawer was
closed. New shops get this from ``SYSTEM_ROLE_PERMISSIONS``; this grants it to
the existing system Cashier role of every shop. Owner-made roles are untouched.
"""

from typing import TYPE_CHECKING

from django.db import migrations

from core.db.rls import set_local_tenant

if TYPE_CHECKING:
    from django.apps.registry import Apps
    from django.db.backends.base.schema import BaseDatabaseSchemaEditor

CASH_DRAWER = "cash.manage"


def grant_cash_drawer(apps: "Apps", schema_editor: "BaseDatabaseSchemaEditor") -> None:
    """Add cash.manage to each shop's system CASHIER role (idempotent)."""
    tenant_model = apps.get_model("tenants", "Tenant")
    role_model = apps.get_model("accounts", "Role")
    role_permission_model = apps.get_model("accounts", "RolePermission")
    for tenant_id in tenant_model.objects.values_list("id", flat=True):
        # role and role_permission are under FORCE RLS, even for the migrator.
        set_local_tenant(schema_editor.connection, tenant_id)
        for role in role_model.objects.filter(tenant_id=tenant_id, code="CASHIER", is_system=True):
            role_permission_model.objects.get_or_create(
                tenant_id=tenant_id, role=role, permission_id=CASH_DRAWER
            )


def revoke_cash_drawer(apps: "Apps", schema_editor: "BaseDatabaseSchemaEditor") -> None:
    """Reverse: take cash.manage back from each shop's system CASHIER role."""
    tenant_model = apps.get_model("tenants", "Tenant")
    role_permission_model = apps.get_model("accounts", "RolePermission")
    for tenant_id in tenant_model.objects.values_list("id", flat=True):
        set_local_tenant(schema_editor.connection, tenant_id)
        role_permission_model.objects.filter(
            tenant_id=tenant_id,
            role__code="CASHIER",
            role__is_system=True,
            permission_id=CASH_DRAWER,
        ).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0002_account_security"),
        # cash.manage is seeded into the permission catalog here.
        ("payments", "0001_initial"),
    ]

    operations = [migrations.RunPython(grant_cash_drawer, revoke_cash_drawer)]
