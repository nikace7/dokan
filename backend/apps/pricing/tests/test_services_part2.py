"""Pricing service tests — the resolution and guardrail matrices.

Money-critical: apps/pricing must stay at 100% coverage (see docs/ARCHITECTURE.md).
Chain under test (design §4.2): VARIANT → ITEM → CATEGORY (nearest ancestor
first) → variant.mrp → 409 PRICE_NOT_SET.
"""

from datetime import date
from decimal import Decimal
from typing import Any

import pytest

from apps.accounts.models import Permission
from apps.pricing import services
from apps.pricing.models import ItemPrice, PriceChangeLog, RateType
from core.responses import ServiceError
from tests.factories import (
    CategoryFactory,
    ItemFactory,
    ItemPriceFactory,
    ItemVariantFactory,
    RateTypeFactory,
    RoleFactory,
    RolePermissionFactory,
    TenantFactory,
    UserFactory,
    UserRoleFactory,
)

pytestmark = pytest.mark.django_db

D1 = date(2026, 1, 1)
D2 = date(2026, 2, 1)
D3 = date(2026, 3, 1)


@pytest.fixture
def tenant() -> Any:
    return TenantFactory()


def make_user(tenant: Any, *codes: str) -> Any:
    """A user with the given permission codenames granted."""
    user = UserFactory(tenant=tenant)
    if codes:
        role = RoleFactory(tenant=tenant)
        for code in codes:
            RolePermissionFactory(
                tenant=tenant, role=role, permission=Permission.objects.get(code=code)
            )
        UserRoleFactory(tenant=tenant, user=user, role=role)
    return user


@pytest.fixture
def user(tenant: Any) -> Any:
    return make_user(tenant)


@pytest.fixture
def rate_type(tenant: Any) -> Any:
    return RateTypeFactory(tenant=tenant, code="RETAIL", is_default=True)


@pytest.fixture
def tree(tenant: Any) -> dict[str, Any]:
    """Category tree: grandparent → parent → item; one variant with MRP."""
    grandparent = CategoryFactory(tenant=tenant, name="Clothing")
    parent = CategoryFactory(tenant=tenant, name="Shirts", parent=grandparent)
    item = ItemFactory(tenant=tenant, category=parent)
    variant = ItemVariantFactory(tenant=tenant, item=item, mrp=Decimal("1500.00"))
    return {
        "grandparent": grandparent,
        "parent": parent,
        "item": item,
        "variant": variant,
    }


def price(tenant: Any, rate_type: Any, scope: str, on: date = D1, **kwargs: Any) -> Any:
    """Shortcut to plant an effective-dated price row.

    Clears the other scope FKs: ItemPriceFactory defaults to a VARIANT row,
    which would violate the exactly-one-scope-FK CHECK for ITEM/CATEGORY.
    """
    cleared = {"variant": None, "item": None, "category": None, **kwargs}
    return ItemPriceFactory(
        tenant=tenant, rate_type=rate_type, scope=scope, effective_from=on, **cleared
    )


class TestSetPrice:
    def test_first_price_logs_old_none(
        self, tenant: Any, user: Any, rate_type: Any, tree: dict
    ) -> None:
        services.set_price(
            tenant,
            rate_type=rate_type,
            scope="VARIANT",
            variant=tree["variant"],
            price=Decimal("900"),
            effective_from=D1,
            created_by=user,
            reason="Initial",
        )
        log = PriceChangeLog.objects.get(tenant=tenant)
        assert log.old_price is None
        assert log.new_price == Decimal("900")
        assert log.reason == "Initial"
        assert log.changed_by == user
        assert log.target_type == "VARIANT"
        assert log.target_id == tree["variant"].pk

    def test_replace_same_scope_and_date_updates_row(
        self, tenant: Any, user: Any, rate_type: Any, tree: dict
    ) -> None:
        kw: dict[str, Any] = {
            "rate_type": rate_type,
            "scope": "VARIANT",
            "variant": tree["variant"],
            "effective_from": D1,
            "created_by": user,
        }
        services.set_price(tenant, price=Decimal("900"), **kw)
        services.set_price(tenant, price=Decimal("950"), **kw)
        assert ItemPrice.objects.filter(tenant=tenant).count() == 1
        assert ItemPrice.objects.get(tenant=tenant).price == Decimal("950")
        log = PriceChangeLog.objects.filter(tenant=tenant).order_by("-created_at").first()
        assert log is not None and log.old_price == Decimal("900")

    def test_new_effective_date_logs_previous_effective_price(
        self, tenant: Any, user: Any, rate_type: Any, tree: dict
    ) -> None:
        services.set_price(
            tenant,
            rate_type=rate_type,
            scope="VARIANT",
            variant=tree["variant"],
            price=Decimal("900"),
            effective_from=D1,
            created_by=user,
        )
        services.set_price(
            tenant,
            rate_type=rate_type,
            scope="VARIANT",
            variant=tree["variant"],
            price=Decimal("950"),
            effective_from=D2,
            created_by=user,
        )
        assert ItemPrice.objects.filter(tenant=tenant).count() == 2
        log = PriceChangeLog.objects.filter(tenant=tenant).order_by("-created_at").first()
        assert log is not None and log.old_price == Decimal("900")

    @pytest.mark.parametrize(
        ("scope", "missing"),
        [("VARIANT", "item"), ("ITEM", "variant"), ("CATEGORY", "variant")],
    )
    def test_wrong_scope_fk_combination_rejected(
        self, tenant: Any, user: Any, rate_type: Any, tree: dict, scope: str, missing: str
    ) -> None:
        """Only the FK matching the scope may be passed."""
        kwargs: dict[str, Any] = {missing: tree["item" if missing == "item" else "variant"]}
        with pytest.raises(ServiceError) as exc:
            services.set_price(
                tenant,
                rate_type=rate_type,
                scope=scope,
                price=Decimal("100"),
                effective_from=D1,
                created_by=user,
                **kwargs,
            )
        assert exc.value.code == "SCOPE_TARGET_REQUIRED"

    def test_invalid_scope_rejected(self, tenant: Any, user: Any, rate_type: Any) -> None:
        with pytest.raises(ServiceError) as exc:
            services.set_price(
                tenant,
                rate_type=rate_type,
                scope="SHOP",
                price=Decimal("100"),
                effective_from=D1,
                created_by=user,
            )
        assert exc.value.code == "SCOPE_INVALID"

    def test_non_positive_price_rejected(
        self, tenant: Any, user: Any, rate_type: Any, tree: dict
    ) -> None:
        with pytest.raises(ServiceError) as exc:
            services.set_price(
                tenant,
                rate_type=rate_type,
                scope="VARIANT",
                variant=tree["variant"],
                price=Decimal("0"),
                effective_from=D1,
                created_by=user,
            )
        assert exc.value.code == "PRICE_INVALID"

    def test_inverted_date_range_rejected(
        self, tenant: Any, user: Any, rate_type: Any, tree: dict
    ) -> None:
        with pytest.raises(ServiceError) as exc:
            services.set_price(
                tenant,
                rate_type=rate_type,
                scope="VARIANT",
                variant=tree["variant"],
                price=Decimal("100"),
                effective_from=D2,
                effective_to=D1,
                created_by=user,
            )
        assert exc.value.code == "DATE_RANGE_INVALID"

    def test_category_scope_set_price(
        self, tenant: Any, user: Any, rate_type: Any, tree: dict
    ) -> None:
        item_price = services.set_price(
            tenant,
            rate_type=rate_type,
            scope="CATEGORY",
            category=tree["parent"],
            price=Decimal("999"),
            effective_from=D1,
            created_by=user,
        )
        assert item_price.category == tree["parent"]


class TestRateTypes:
    def test_custom_rate_types_require_plan_feature(self, tenant: Any, user: Any) -> None:
        tenant.plan.features = {"custom_rate_types": False, "max_rate_types": 3}
        tenant.plan.save(update_fields=["features"])

        with pytest.raises(ServiceError) as exc:
            services.create_rate_type(tenant, user=user, code="VIP", name="VIP")

        assert exc.value.code == "PLAN_FEATURE_REQUIRED"
        assert exc.value.http_status == 402

    def test_rate_type_creation_hard_blocks_at_plan_limit(self, tenant: Any, user: Any) -> None:
        tenant.plan.features = {"custom_rate_types": True, "max_rate_types": 1}
        tenant.plan.save(update_fields=["features"])
        RateTypeFactory(tenant=tenant)

        with pytest.raises(ServiceError) as exc:
            services.create_rate_type(tenant, user=user, code="VIP", name="VIP")

        assert exc.value.code == "PLAN_LIMIT_REACHED"

    def test_first_default_and_replacement(self, tenant: Any, user: Any) -> None:
        first = services.create_rate_type(
            tenant, user=user, code="RETAIL", name="Retail", is_default=True
        )
        second = services.create_rate_type(
            tenant, user=user, code="THOK", name="Wholesale", is_default=True
        )
        first.refresh_from_db()
        assert first.is_default is False
        assert second.is_default is True

    def test_update_to_default_unsets_previous(self, tenant: Any, user: Any) -> None:
        first = services.create_rate_type(
            tenant, user=user, code="RETAIL", name="Retail", is_default=True
        )
        second = services.create_rate_type(tenant, user=user, code="THOK", name="Wholesale")
        services.update_rate_type(tenant, second, is_default=True)
        first.refresh_from_db()
        assert first.is_default is False

    def test_duplicate_code_friendly_error(self, tenant: Any, user: Any) -> None:
        services.create_rate_type(tenant, user=user, code="RETAIL", name="Retail")
        with pytest.raises(ServiceError) as exc:
            services.create_rate_type(tenant, user=user, code="RETAIL", name="Again")
        assert exc.value.code == "ALREADY_EXISTS"

    def test_update_duplicate_code_friendly_error(self, tenant: Any, user: Any) -> None:
        services.create_rate_type(tenant, user=user, code="RETAIL", name="Retail")
        other = services.create_rate_type(tenant, user=user, code="THOK", name="Wholesale")
        with pytest.raises(ServiceError) as exc:
            services.update_rate_type(tenant, other, code="RETAIL")
        assert exc.value.code == "ALREADY_EXISTS"

    def test_deactivate_soft_delete_only(self, tenant: Any, user: Any) -> None:
        rate_type = services.create_rate_type(tenant, user=user, code="VIP", name="VIP")
        services.deactivate_rate_type(rate_type)
        rate_type.refresh_from_db()
        assert rate_type.is_active is False
        assert RateType.objects.filter(pk=rate_type.pk).exists()

    def test_default_rate_type_cannot_deactivate(self, tenant: Any, user: Any) -> None:
        rate_type = services.create_rate_type(
            tenant, user=user, code="RETAIL", name="Retail", is_default=True
        )
        with pytest.raises(ServiceError) as exc:
            services.deactivate_rate_type(rate_type)
        assert exc.value.code == "RATE_TYPE_IN_USE"

    def test_get_default_rate_type_missing(self, tenant: Any) -> None:
        with pytest.raises(ServiceError) as exc:
            services.get_default_rate_type(tenant)
        assert exc.value.code == "RATE_TYPE_NOT_FOUND"

    def test_get_default_rate_type_found(self, tenant: Any, rate_type: Any) -> None:
        assert services.get_default_rate_type(tenant).pk == rate_type.pk

    def test_required_permission_must_exist(self, tenant: Any, user: Any) -> None:
        with pytest.raises(ServiceError) as exc:
            services.create_rate_type(
                tenant, user=user, code="X", name="X", required_permission="no.such.perm"
            )
        assert exc.value.code == "PERMISSION_NOT_FOUND"

    def test_required_permission_valid(self, tenant: Any, user: Any) -> None:
        rate_type = services.create_rate_type(
            tenant, user=user, code="THOK", name="Thok", required_permission="pricing.edit"
        )
        assert rate_type.required_permission_id == "pricing.edit"

    def test_update_required_permission_valid(self, tenant: Any, user: Any) -> None:
        rate_type = services.create_rate_type(tenant, user=user, code="VIP", name="VIP")
        updated = services.update_rate_type(tenant, rate_type, required_permission="pricing.edit")
        assert updated.required_permission_id == "pricing.edit"


class TestModelStr:
    def test_rate_type_str(self, rate_type: Any) -> None:
        assert str(rate_type) == f"{rate_type.name} ({rate_type.code})"

    def test_item_price_str(self, tenant: Any, rate_type: Any, tree: dict) -> None:
        row = price(tenant, rate_type, "VARIANT", variant=tree["variant"])
        assert str(row) == f"VARIANT price {row.price} (RETAIL)"

    def test_price_change_log_str(self, tenant: Any, user: Any, rate_type: Any, tree: dict) -> None:
        services.set_price(
            tenant,
            rate_type=rate_type,
            scope="VARIANT",
            variant=tree["variant"],
            price=Decimal("900"),
            effective_from=D1,
            created_by=user,
        )
        log = PriceChangeLog.objects.get(tenant=tenant)
        assert str(log) == f"VARIANT {tree['variant'].pk}: {log.old_price} → {log.new_price}"


class TestUniquenessReraise:
    def test_non_uniqueness_integrity_error_reraises_on_create(
        self, tenant: Any, user: Any, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A non-constraint IntegrityError must propagate, not become ALREADY_EXISTS."""
        from django.db import IntegrityError

        def broken_save(self: Any, **kwargs: Any) -> None:
            raise IntegrityError("some unrelated database error")

        monkeypatch.setattr(RateType, "save", broken_save)
        with pytest.raises(IntegrityError, match="unrelated"):
            services.create_rate_type(tenant, user=user, code="X", name="X")

    def test_non_uniqueness_integrity_error_reraises_on_update(
        self, tenant: Any, user: Any, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from django.db import IntegrityError

        rate_type = services.create_rate_type(tenant, user=user, code="X", name="X")

        def broken_save(self: Any, **kwargs: Any) -> None:
            raise IntegrityError("some unrelated database error")

        monkeypatch.setattr(RateType, "save", broken_save)
        with pytest.raises(IntegrityError, match="unrelated"):
            services.update_rate_type(tenant, rate_type, name="Y")
