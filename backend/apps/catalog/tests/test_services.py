"""Service-layer tests for catalog: business rules that must hold regardless
of the API surface — price bounds, category cycle guard, tenant-scoped FK
references, matrix bulk entry, friendly uniqueness errors, barcode checks.
"""

from decimal import Decimal

import pytest

from apps.catalog import services
from apps.catalog.models import ItemVariant, SizeChart
from core.responses import ServiceError
from tests.factories import (
    CategoryFactory,
    ItemFactory,
    ItemVariantFactory,
    SizeChartFactory,
    TenantFactory,
    UserFactory,
)

pytestmark = pytest.mark.django_db


class TestWebsiteOffer:
    def test_out_of_range_discount_rejected_on_create(self) -> None:
        tenant = TenantFactory()
        with pytest.raises(ServiceError) as exc:
            services.create_item(
                tenant,
                created_by=UserFactory(tenant=tenant),
                code="A1",
                name="Bad offer",
                website_discount_pct=Decimal("95.00"),
            )
        assert exc.value.code == "DISCOUNT_OUT_OF_RANGE"

    def test_zero_discount_rejected_on_update(self) -> None:
        item = ItemFactory()
        with pytest.raises(ServiceError) as exc:
            services.update_item(item.tenant, item, website_discount_pct=Decimal("0"))
        assert exc.value.code == "DISCOUNT_OUT_OF_RANGE"

    def test_merchandising_fields_round_trip(self) -> None:
        tenant = TenantFactory()
        item = services.create_item(
            tenant,
            created_by=UserFactory(tenant=tenant),
            code="A2",
            name="Featured",
            website_price=Decimal("1500.00"),
            website_discount_pct=Decimal("20.00"),
            website_featured=True,
        )
        assert item.website_visible is True  # default: online unless hidden
        assert item.website_featured is True

        updated = services.update_item(tenant, item, website_visible=False)
        assert updated.website_visible is False


class TestPriceBounds:
    def test_min_above_max_rejected_on_create(self) -> None:
        tenant = TenantFactory()
        with pytest.raises(ServiceError) as exc:
            services.create_item(
                tenant,
                created_by=UserFactory(tenant=tenant),
                code="A1",
                name="Bad",
                min_selling_price=Decimal("1000.00"),
                max_selling_price=Decimal("500.00"),
            )
        assert exc.value.code == "PRICE_BOUNDS_INVALID"

    def test_min_above_max_rejected_on_update(self) -> None:
        item = ItemFactory(min_selling_price=Decimal("100.00"))
        with pytest.raises(ServiceError) as exc:
            services.update_item(item.tenant, item, max_selling_price=Decimal("50.00"))
        assert exc.value.code == "PRICE_BOUNDS_INVALID"

    def test_single_bound_allowed(self) -> None:
        tenant = TenantFactory()
        item = services.create_item(
            tenant,
            created_by=UserFactory(tenant=tenant),
            code="A2",
            name="Only min",
            min_selling_price=Decimal("100.00"),
        )
        assert item.min_selling_price == Decimal("100.00")


class TestPlanLimits:
    def test_item_creation_hard_blocks_at_plan_limit(self) -> None:
        tenant = TenantFactory()
        tenant.plan.limits = {"max_items": 1}
        tenant.plan.save(update_fields=["limits"])
        ItemFactory(tenant=tenant)

        with pytest.raises(ServiceError) as exc:
            services.create_item(
                tenant,
                created_by=UserFactory(tenant=tenant),
                code="LIMITED",
                name="Blocked item",
            )

        assert exc.value.code == "PLAN_LIMIT_REACHED"
        assert exc.value.http_status == 402


class TestCategoryCycleGuard:
    def test_reparent_into_own_subtree_rejected(self) -> None:
        tenant = TenantFactory()
        root = CategoryFactory(tenant=tenant, name="Root")
        child = CategoryFactory(tenant=tenant, name="Child", parent=root)
        with pytest.raises(ServiceError) as exc:
            services.update_category(tenant, root, parent=child.pk)
        assert exc.value.code == "CATEGORY_CYCLE"

    def test_self_parent_rejected(self) -> None:
        category = CategoryFactory()
        with pytest.raises(ServiceError) as exc:
            services.update_category(category.tenant, category, parent=category.pk)
        assert exc.value.code == "CATEGORY_CYCLE"

    def test_valid_reparent_accepted(self) -> None:
        tenant = TenantFactory()
        a = CategoryFactory(tenant=tenant, name="A")
        b = CategoryFactory(tenant=tenant, name="B")
        updated = services.update_category(tenant, b, parent=a.pk)
        assert updated.parent == a


class TestTenantScopedFk:
    def test_item_rejects_category_of_another_tenant(self) -> None:
        tenant = TenantFactory()
        foreign_category = CategoryFactory()  # different tenant
        with pytest.raises(ServiceError) as exc:
            services.create_item(
                tenant,
                created_by=UserFactory(tenant=tenant),
                code="X1",
                name="Cross",
                category=foreign_category.pk,
            )
        assert exc.value.code == "CATEGORY_NOT_FOUND"
        assert exc.value.http_status == 404


class TestSizeChart:
    def test_empty_values_rejected(self) -> None:
        with pytest.raises(ServiceError) as exc:
            services.create_size_chart(TenantFactory(), name="Empty", values=[" ", ""])
        assert exc.value.code == "SIZE_CHART_EMPTY"

    def test_values_are_stripped(self) -> None:
        chart = services.create_size_chart(TenantFactory(), name="Ok", values=[" S ", "M"])
        assert chart.values == ["S", "M"]


class TestMatrixBulkEntry:
    def test_grid_created_with_deterministic_skus(self) -> None:
        item = ItemFactory(code="TEE-01")
        result = services.bulk_create_variants(
            item.tenant, item=item, sizes=["S", "M"], colors=["Black", "White"]
        )
        assert result["created_count"] == 4
        assert result["skipped_count"] == 0
        skus = sorted(v.sku for v in result["created"])
        assert skus == [
            "TEE-01-M-BLACK",
            "TEE-01-M-WHITE",
            "TEE-01-S-BLACK",
            "TEE-01-S-WHITE",
        ]

    def test_existing_combos_skipped_not_duplicated(self) -> None:
        item = ItemFactory(code="TEE-02")
        ItemVariantFactory(item=item, tenant=item.tenant, size="M", color="Black")
        result = services.bulk_create_variants(
            item.tenant, item=item, sizes=["M"], colors=["Black", "White"]
        )
        assert result["created_count"] == 1
        assert result["skipped_count"] == 1
        assert result["skipped"][0]["size"] == "M"
        assert (
            ItemVariant.objects.filter(
                tenant=item.tenant, item=item, size="M", color="Black"
            ).count()
            == 1
        )

    def test_empty_matrix_rejected(self) -> None:
        item = ItemFactory()
        with pytest.raises(ServiceError) as exc:
            services.bulk_create_variants(item.tenant, item=item, sizes=[], colors=["Black"])
        assert exc.value.code == "MATRIX_EMPTY"


class TestVariantRules:
    def test_duplicate_sku_friendly_error(self) -> None:
        tenant = TenantFactory()
        ItemVariantFactory(tenant=tenant, sku="DUP-1")
        item = ItemFactory(tenant=tenant)
        with pytest.raises(ServiceError) as exc:
            services.create_variant(tenant, item=item, size="L", color="Red", sku="DUP-1")
        assert exc.value.code == "ALREADY_EXISTS"
        assert "SKU" in exc.value.message

    def test_invalid_barcode_rejected(self) -> None:
        item = ItemFactory()
        with pytest.raises(ServiceError) as exc:
            services.create_variant(
                item.tenant, item=item, size="L", color="Red", sku="V-1", barcode="5901234123458"
            )
        assert exc.value.code == "BARCODE_INVALID"

    def test_valid_ean13_barcode_accepted(self) -> None:
        item = ItemFactory()
        variant = services.create_variant(
            item.tenant, item=item, size="L", color="Red", sku="V-2", barcode="5901234123457"
        )
        assert variant.barcode == "5901234123457"

    def test_avg_cost_not_writable_via_service(self) -> None:
        """avg_cost is inventory's column; catalog create must not accept it."""
        item = ItemFactory()
        variant = services.create_variant(item.tenant, item=item, size="L", color="Red", sku="V-3")
        assert variant.avg_cost == Decimal("0")


class TestDeactivate:
    def test_deactivate_flips_flag_not_deletes(self) -> None:
        chart = SizeChartFactory()
        services.deactivate(chart)
        chart.refresh_from_db()
        assert chart.is_active is False
        assert SizeChart.objects.filter(pk=chart.pk).exists()
