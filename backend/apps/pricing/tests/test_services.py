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
from core.responses import ServiceError
from tests.factories import (
    CategoryFactory,
    ItemCategoryPriceFactory,
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


class TestResolutionChain:
    def test_variant_scope_beats_everything(
        self, tenant: Any, user: Any, rate_type: Any, tree: dict
    ) -> None:
        price(tenant, rate_type, "VARIANT", variant=tree["variant"], price=Decimal("900"))
        price(tenant, rate_type, "ITEM", item=tree["item"], price=Decimal("950"))
        ItemCategoryPriceFactory(
            tenant=tenant, rate_type=rate_type, category=tree["parent"], price=Decimal("999")
        )
        result = services.resolve_price(
            tenant, variant=tree["variant"], rate_type=rate_type, on_date=D2, user=user
        )
        assert result.price == Decimal("900")
        assert result.source == "VARIANT"
        assert result.item_price is not None

    def test_item_scope_beats_category_and_mrp(
        self, tenant: Any, user: Any, rate_type: Any, tree: dict
    ) -> None:
        price(tenant, rate_type, "ITEM", item=tree["item"], price=Decimal("950"))
        ItemCategoryPriceFactory(
            tenant=tenant, rate_type=rate_type, category=tree["parent"], price=Decimal("999")
        )
        result = services.resolve_price(
            tenant, variant=tree["variant"], rate_type=rate_type, on_date=D2, user=user
        )
        assert (result.price, result.source) == (Decimal("950"), "ITEM")

    def test_category_scope_beats_mrp(
        self, tenant: Any, user: Any, rate_type: Any, tree: dict
    ) -> None:
        ItemCategoryPriceFactory(
            tenant=tenant, rate_type=rate_type, category=tree["parent"], price=Decimal("999")
        )
        result = services.resolve_price(
            tenant, variant=tree["variant"], rate_type=rate_type, on_date=D2, user=user
        )
        assert (result.price, result.source) == (Decimal("999"), "CATEGORY")

    def test_nearest_ancestor_wins_in_tree(
        self, tenant: Any, user: Any, rate_type: Any, tree: dict
    ) -> None:
        """Price on parent beats price on grandparent."""
        ItemCategoryPriceFactory(
            tenant=tenant, rate_type=rate_type, category=tree["parent"], price=Decimal("999")
        )
        ItemCategoryPriceFactory(
            tenant=tenant, rate_type=rate_type, category=tree["grandparent"], price=Decimal("888")
        )
        result = services.resolve_price(
            tenant, variant=tree["variant"], rate_type=rate_type, on_date=D2, user=user
        )
        assert result.price == Decimal("999")

    def test_grandparent_price_used_when_parent_has_none(
        self, tenant: Any, user: Any, rate_type: Any, tree: dict
    ) -> None:
        ItemCategoryPriceFactory(
            tenant=tenant, rate_type=rate_type, category=tree["grandparent"], price=Decimal("888")
        )
        result = services.resolve_price(
            tenant, variant=tree["variant"], rate_type=rate_type, on_date=D2, user=user
        )
        assert (result.price, result.source) == (Decimal("888"), "CATEGORY")

    def test_mrp_fallback(self, tenant: Any, user: Any, rate_type: Any, tree: dict) -> None:
        result = services.resolve_price(
            tenant, variant=tree["variant"], rate_type=rate_type, on_date=D2, user=user
        )
        assert (result.price, result.source, result.item_price) == (
            Decimal("1500.00"),
            "MRP",
            None,
        )

    def test_no_price_no_mrp_is_409(self, tenant: Any, user: Any, rate_type: Any) -> None:
        variant = ItemVariantFactory(tenant=tenant, mrp=None)
        with pytest.raises(ServiceError) as exc:
            services.resolve_price(
                tenant, variant=variant, rate_type=rate_type, on_date=D2, user=user
            )
        assert exc.value.code == "PRICE_NOT_SET"
        assert exc.value.http_status == 409

    def test_item_without_category_skips_tree(self, tenant: Any, user: Any, rate_type: Any) -> None:
        item = ItemFactory(tenant=tenant, category=None)
        variant = ItemVariantFactory(tenant=tenant, item=item, mrp=Decimal("700"))
        result = services.resolve_price(
            tenant, variant=variant, rate_type=rate_type, on_date=D2, user=user
        )
        assert (result.price, result.source) == (Decimal("700"), "MRP")


class TestEffectiveDates:
    def test_future_price_ignored(self, tenant: Any, user: Any, rate_type: Any, tree: dict) -> None:
        price(
            tenant, rate_type, "VARIANT", on=D3, variant=tree["variant"], price=Decimal("900")
        )  # starts after D2
        result = services.resolve_price(
            tenant, variant=tree["variant"], rate_type=rate_type, on_date=D2, user=user
        )
        assert result.source == "MRP"

    def test_expired_price_ignored(
        self, tenant: Any, user: Any, rate_type: Any, tree: dict
    ) -> None:
        price(
            tenant,
            rate_type,
            "VARIANT",
            variant=tree["variant"],
            price=Decimal("900"),
            effective_to=D2,
        )
        result = services.resolve_price(
            tenant, variant=tree["variant"], rate_type=rate_type, on_date=D3, user=user
        )
        assert result.source == "MRP"

    def test_boundary_dates_are_inclusive(
        self, tenant: Any, user: Any, rate_type: Any, tree: dict
    ) -> None:
        """§4.2: effective_from <= d AND effective_to >= d — both inclusive."""
        price(
            tenant,
            rate_type,
            "VARIANT",
            on=D1,
            variant=tree["variant"],
            price=Decimal("900"),
            effective_to=D2,
        )
        for boundary in (D1, D2):
            result = services.resolve_price(
                tenant, variant=tree["variant"], rate_type=rate_type, on_date=boundary, user=user
            )
            assert result.price == Decimal("900"), f"boundary {boundary} must be inclusive"

    def test_most_recent_effective_from_wins(
        self, tenant: Any, user: Any, rate_type: Any, tree: dict
    ) -> None:
        price(tenant, rate_type, "VARIANT", on=D1, variant=tree["variant"], price=Decimal("900"))
        price(tenant, rate_type, "VARIANT", on=D2, variant=tree["variant"], price=Decimal("850"))
        result = services.resolve_price(
            tenant, variant=tree["variant"], rate_type=rate_type, on_date=D3, user=user
        )
        assert result.price == Decimal("850")

    def test_on_date_defaults_to_today(
        self, tenant: Any, user: Any, rate_type: Any, tree: dict
    ) -> None:
        """Without on_date, resolution uses the Kathmandu operating date."""
        result = services.resolve_price(
            tenant, variant=tree["variant"], rate_type=rate_type, user=user
        )
        assert result.source == "MRP"


class TestRestrictedRateTypes:
    def _restricted(self, tenant: Any) -> Any:
        return RateTypeFactory(
            tenant=tenant,
            code="THOK",
            required_permission=Permission.objects.get(code="pricing.edit"),
        )

    def test_restricted_rate_denied_without_permission(
        self, tenant: Any, user: Any, tree: dict
    ) -> None:
        rate_type = self._restricted(tenant)
        with pytest.raises(ServiceError) as exc:
            services.resolve_price(tenant, variant=tree["variant"], rate_type=rate_type, user=user)
        assert exc.value.code == "PRICING_RATE_FORBIDDEN"
        assert exc.value.http_status == 403

    def test_restricted_rate_allowed_with_permission(self, tenant: Any, tree: dict) -> None:
        user = make_user(tenant, "pricing.edit")
        rate_type = self._restricted(tenant)
        result = services.resolve_price(
            tenant, variant=tree["variant"], rate_type=rate_type, on_date=D2, user=user
        )
        assert result.source == "MRP"


class TestGuardrails:
    def test_variant_override_beats_item_and_category(
        self, tenant: Any, user: Any, tree: dict
    ) -> None:
        tree["variant"].min_selling_price = Decimal("800")
        tree["item"].min_selling_price = Decimal("700")
        tree["parent"].min_price_pct = Decimal("50")  # 50% of MRP 1500 = 750
        min_price, _ = services.effective_price_bounds(tenant, variant=tree["variant"])
        assert min_price == Decimal("800")

    def test_item_beats_category_pct(self, tenant: Any, user: Any, tree: dict) -> None:
        tree["item"].min_selling_price = Decimal("700")
        tree["parent"].min_price_pct = Decimal("50")
        min_price, _ = services.effective_price_bounds(tenant, variant=tree["variant"])
        assert min_price == Decimal("700")

    def test_category_pct_of_mrp_from_nearest_ancestor(
        self, tenant: Any, user: Any, tree: dict
    ) -> None:
        tree["grandparent"].min_price_pct = Decimal("60")  # 60% of 1500 = 900
        tree["grandparent"].max_price_pct = Decimal("200")  # 200% of 1500 = 3000
        min_price, max_price = services.effective_price_bounds(tenant, variant=tree["variant"])
        assert min_price == Decimal("900.00")
        assert max_price == Decimal("3000.00")

    def test_category_pct_skipped_without_mrp(self, tenant: Any, user: Any) -> None:
        category = CategoryFactory(tenant=tenant, min_price_pct=Decimal("50"))
        item = ItemFactory(tenant=tenant, category=category)
        variant = ItemVariantFactory(tenant=tenant, item=item, mrp=None)
        min_price, max_price = services.effective_price_bounds(tenant, variant=variant)
        assert (min_price, max_price) == (None, None)

    def test_below_min_blocked_without_permission(self, tenant: Any, user: Any, tree: dict) -> None:
        tree["variant"].min_selling_price = Decimal("850")
        with pytest.raises(ServiceError) as exc:
            services.assert_price_within_bounds(
                tenant, variant=tree["variant"], price=Decimal("800"), user=user
            )
        assert exc.value.code == "PRICE_BELOW_MIN"
        assert "850" in exc.value.message  # the selling bound may be shown
        assert "cost" not in exc.value.message.lower()  # invariant 10

    def test_below_min_with_permission_requires_reason(self, tenant: Any, tree: dict) -> None:
        user = make_user(tenant, "pricing.override_min")
        tree["variant"].min_selling_price = Decimal("850")
        with pytest.raises(ServiceError) as exc:
            services.assert_price_within_bounds(
                tenant, variant=tree["variant"], price=Decimal("800"), user=user
            )
        assert exc.value.code == "OVERRIDE_REASON_REQUIRED"

    def test_below_min_with_permission_and_reason_passes(self, tenant: Any, tree: dict) -> None:
        user = make_user(tenant, "pricing.override_min")
        tree["variant"].min_selling_price = Decimal("850")
        services.assert_price_within_bounds(
            tenant, variant=tree["variant"], price=Decimal("800"), user=user, reason="Dashain sale"
        )

    def test_above_max_always_rejected(self, tenant: Any, tree: dict) -> None:
        """Even a user with pricing.override_min cannot exceed the max."""
        user = make_user(tenant, "pricing.override_min")
        tree["variant"].max_selling_price = Decimal("1600")
        with pytest.raises(ServiceError) as exc:
            services.assert_price_within_bounds(
                tenant, variant=tree["variant"], price=Decimal("1700"), user=user
            )
        assert exc.value.code == "PRICE_ABOVE_MAX"
        assert "cost" not in exc.value.message.lower()

    def test_within_bounds_passes(self, tenant: Any, user: Any, tree: dict) -> None:
        tree["variant"].min_selling_price = Decimal("800")
        tree["variant"].max_selling_price = Decimal("1600")
        services.assert_price_within_bounds(
            tenant, variant=tree["variant"], price=Decimal("1200"), user=user
        )

    def test_no_bounds_passes(self, tenant: Any, user: Any) -> None:
        variant = ItemVariantFactory(tenant=tenant, mrp=None)
        services.assert_price_within_bounds(tenant, variant=variant, price=Decimal("1"), user=user)

    def test_set_bounds_valid(self, tenant: Any, user: Any) -> None:
        variant = ItemVariantFactory(tenant=tenant)
        services.set_price_bounds(
            target=variant,
            min_selling_price=Decimal("500"),
            max_selling_price=Decimal("2000"),
            user=user,
        )
        variant.refresh_from_db()
        assert variant.min_selling_price == Decimal("500")

    def test_set_bounds_inverted_rejected(self, tenant: Any, user: Any) -> None:
        variant = ItemVariantFactory(tenant=tenant)
        with pytest.raises(ServiceError) as exc:
            services.set_price_bounds(
                target=variant,
                min_selling_price=Decimal("2000"),
                max_selling_price=Decimal("500"),
                user=user,
            )
        assert exc.value.code == "PRICE_BOUNDS_INVALID"
