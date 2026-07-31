"""Tenant isolation suite — the test that protects the business.

Runs in CI on every PR (AGENTS.md). Parametrized over EVERY concrete
``TenantScopedModel`` subclass: tenant A must get empty querysets for every
row of tenant B — enforced by Postgres RLS, so a forgotten ``.filter()`` is
structurally unable to leak.

How RLS is exercised here: the test connection is a superuser (it must be,
to create the test database), and superusers bypass RLS. So each test first
``SET LOCAL ROLE`` to a plain non-superuser, non-owner role — from then on
the connection is subject to the ``tenant_isolation`` policies exactly like
the production app role.

How to extend (per new tenant-scoped model):
1. Add a factory in ``tests/factories/`` that hangs off ``TenantFactory``.
2. Register it in ``FACTORIES`` below.
The meta-test fails CI until the model is covered — nothing slips through.
"""

from typing import Any, Final

import pytest
from django.apps import apps
from django.db import ProgrammingError, connection, transaction

from apps.accounts.models import Role, RolePermission, User, UserRole
from apps.catalog.models import Brand, Category, Item, ItemVariant, SizeChart
from apps.customers.models import Customer
from apps.inventory.models import StockBatch, StockLevel, StockMovement
from apps.payments.models import CashSession, Payment, PaymentAllocation
from apps.pricing.models import ItemPrice, PriceChangeLog, RateType
from apps.purchasing.models import PurchaseInvoice, PurchaseInvoiceItem, Supplier
from apps.sales.models import NumberSequence, SalesInvoice, SalesInvoiceItem
from apps.tenants.models import Branch
from core.db.rls import set_local_tenant
from core.models import TenantScopedModel
from tests.factories import (
    BranchFactory,
    BrandFactory,
    CashSessionFactory,
    CategoryFactory,
    CustomerFactory,
    ItemFactory,
    ItemPriceFactory,
    ItemVariantFactory,
    NumberSequenceFactory,
    PaymentAllocationFactory,
    PaymentFactory,
    PriceChangeLogFactory,
    PurchaseInvoiceFactory,
    PurchaseInvoiceItemFactory,
    RateTypeFactory,
    RoleFactory,
    RolePermissionFactory,
    SalesInvoiceFactory,
    SalesInvoiceItemFactory,
    SizeChartFactory,
    StockBatchFactory,
    StockLevelFactory,
    StockMovementFactory,
    SupplierFactory,
    TenantFactory,
    UserFactory,
    UserRoleFactory,
)

#: model → factory that creates one row for a given tenant.
FACTORIES: dict[type[Any], Any] = {
    Branch: BranchFactory,
    User: UserFactory,
    Role: RoleFactory,
    RolePermission: RolePermissionFactory,
    UserRole: UserRoleFactory,
    Brand: BrandFactory,
    Category: CategoryFactory,
    SizeChart: SizeChartFactory,
    Item: ItemFactory,
    ItemVariant: ItemVariantFactory,
    StockLevel: StockLevelFactory,
    StockMovement: StockMovementFactory,
    RateType: RateTypeFactory,
    ItemPrice: ItemPriceFactory,
    PriceChangeLog: PriceChangeLogFactory,
    Supplier: SupplierFactory,
    PurchaseInvoice: PurchaseInvoiceFactory,
    PurchaseInvoiceItem: PurchaseInvoiceItemFactory,
    StockBatch: StockBatchFactory,
    Payment: PaymentFactory,
    PaymentAllocation: PaymentAllocationFactory,
    CashSession: CashSessionFactory,
    Customer: CustomerFactory,
    NumberSequence: NumberSequenceFactory,
    SalesInvoice: SalesInvoiceFactory,
    SalesInvoiceItem: SalesInvoiceItemFactory,
}

#: Plain role used to become RLS-subject inside the test transaction.
_RLS_TEST_ROLE: Final = "rls_test_app"

pytestmark = pytest.mark.django_db


def tenant_scoped_models() -> list[type[Any]]:
    """Every concrete model that RLS must isolate."""
    return sorted(
        (m for m in apps.get_models() if issubclass(m, TenantScopedModel)),
        key=lambda m: m._meta.label,
    )


def _assume_app_role() -> None:
    """Switch this transaction to a non-superuser role so RLS policies bite."""
    with connection.cursor() as cursor:
        cursor.execute(
            f"""
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{_RLS_TEST_ROLE}') THEN
                    CREATE ROLE {_RLS_TEST_ROLE} NOLOGIN;
                END IF;
            END
            $$;
            """
        )
        cursor.execute(f"GRANT USAGE ON SCHEMA public TO {_RLS_TEST_ROLE}")
        cursor.execute(
            "GRANT SELECT, INSERT, UPDATE, DELETE "
            f"ON ALL TABLES IN SCHEMA public TO {_RLS_TEST_ROLE}"
        )
        cursor.execute(f"SET LOCAL ROLE {_RLS_TEST_ROLE}")


class TestCoverageCompleteness:
    """Meta-tests: the suite itself must cover every tenant-scoped model."""

    def test_every_scoped_model_has_a_factory(self) -> None:
        missing = [m._meta.label for m in tenant_scoped_models() if m not in FACTORIES]
        assert not missing, f"Tenant-scoped models missing from FACTORIES: {missing}"

    def test_discovery_finds_only_scoped_models(self) -> None:
        for model in tenant_scoped_models():
            assert model._meta.get_field("tenant") is not None


@pytest.mark.parametrize(
    "model",
    tenant_scoped_models(),
    ids=lambda m: m._meta.label,
)
def test_cross_tenant_read_denial(model: type[Any]) -> None:
    """Rows of tenant A are invisible when the session runs as tenant B."""
    factory = FACTORIES[model]
    tenant_a = TenantFactory()
    tenant_b = TenantFactory()
    factory(tenant=tenant_a)

    _assume_app_role()

    # As tenant B: nothing of A's is visible.
    set_local_tenant(connection, tenant_b.pk)
    assert model.objects.count() == 0

    # As tenant A: the row is visible — the fixture is sane.
    set_local_tenant(connection, tenant_a.pk)
    assert model.objects.count() == 1


def test_cross_tenant_write_denial() -> None:
    """WITH CHECK: writing a row into another tenant is rejected by the DB.

    Postgres reports an RLS violation as SQLSTATE 42501
    (insufficient_privilege), which Django maps to ProgrammingError.
    """
    tenant_a = TenantFactory()
    tenant_b = TenantFactory()

    _assume_app_role()
    set_local_tenant(connection, tenant_b.pk)

    # Insert a branch whose tenant_id is A while running as B — the policy's
    # WITH CHECK must reject it.
    with pytest.raises(ProgrammingError), transaction.atomic():
        Branch.objects.create(
            tenant=tenant_a, code="EVIL", name="Cross-tenant write", invoice_prefix="EVL"
        )

    # And the write really did not happen (checked as tenant A).
    set_local_tenant(connection, tenant_a.pk)
    assert Branch.objects.filter(code="EVIL").count() == 0


def test_unset_tenant_context_denies_everything() -> None:
    """Fail-closed: no app.tenant_id set → current_setting is NULL → zero rows."""
    tenant_a = TenantFactory()
    BranchFactory(tenant=tenant_a)

    _assume_app_role()
    # Deliberately no set_local_tenant call.
    assert Branch.objects.count() == 0
