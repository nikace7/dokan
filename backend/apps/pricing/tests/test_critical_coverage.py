"""Defensive selector paths covered by the money-critical coverage gate."""

from types import SimpleNamespace
from uuid import uuid4

import pytest

from apps.pricing.models import ItemPrice
from apps.pricing.selectors import item_price_target_label, price_change_target_labels
from tests.factories import TenantFactory


def test_target_label_returns_none_for_incomplete_scope() -> None:
    price = SimpleNamespace(
        scope=ItemPrice.Scope.CATEGORY,
        variant=None,
        item=None,
        category=None,
    )

    assert item_price_target_label(price) is None


@pytest.mark.django_db
def test_change_labels_ignore_unknown_target_types() -> None:
    tenant = TenantFactory()
    unknown = SimpleNamespace(target_type="UNKNOWN", target_id=uuid4())

    assert price_change_target_labels(tenant, [unknown]) == {}  # type: ignore[list-item]
