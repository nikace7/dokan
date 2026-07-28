"""Model and validation tests for tenants (slug rules, immutability)."""

import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError

from tests.factories import BranchFactory, PlanFactory, TenantFactory

pytestmark = pytest.mark.django_db


class TestSlugRules:
    @pytest.mark.parametrize(
        "bad_slug",
        [
            "ab",  # too short
            "a" * 31,  # too long
            "UPPER",  # uppercase
            "bad_slug",  # underscore
            "bad slug",  # space
            "-",  # no alphanumerics
        ],
    )
    def test_invalid_slugs_rejected(self, bad_slug: str) -> None:
        tenant = TenantFactory.build(slug=bad_slug)
        with pytest.raises(ValidationError):
            tenant.full_clean()

    @pytest.mark.parametrize("reserved", ["www", "app", "api", "admin", "mail", "staging"])
    def test_reserved_slugs_rejected(self, reserved: str) -> None:
        tenant = TenantFactory.build(slug=reserved)
        with pytest.raises(ValidationError, match="reserved"):
            tenant.full_clean()

    def test_valid_slug_accepted(self) -> None:
        tenant = TenantFactory(slug="shree-ganesh-1")
        tenant.full_clean()  # must not raise


class TestSlugImmutability:
    def test_slug_cannot_change_after_creation(self) -> None:
        tenant = TenantFactory()
        tenant.slug = "new-slug"
        with pytest.raises(ValidationError, match="immutable"):
            tenant.save()

    def test_other_fields_can_change(self) -> None:
        tenant = TenantFactory()
        tenant.name = "Renamed Shop"
        tenant.save()
        tenant.refresh_from_db()
        assert tenant.name == "Renamed Shop"


class TestBranchConstraints:
    def test_code_unique_per_tenant(self) -> None:
        tenant = TenantFactory()
        BranchFactory(tenant=tenant, code="MAIN")
        with pytest.raises(IntegrityError):
            BranchFactory(tenant=tenant, code="MAIN")

    def test_same_code_allowed_in_another_tenant(self) -> None:
        BranchFactory(code="MAIN")
        BranchFactory(code="MAIN")  # different tenant — must not raise

    def test_only_one_default_branch_per_tenant(self) -> None:
        tenant = TenantFactory()
        BranchFactory(tenant=tenant, is_default=True)
        with pytest.raises(IntegrityError):
            BranchFactory(tenant=tenant, is_default=True)

    def test_plan_is_required(self) -> None:
        with pytest.raises(IntegrityError):
            TenantFactory(plan=None)


class TestPlanModel:
    def test_str(self) -> None:
        plan = PlanFactory(code="basic", name="Basic")
        assert str(plan) == "Basic (basic)"
