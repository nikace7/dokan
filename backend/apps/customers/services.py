"""Write-side business logic for customers."""

from typing import TYPE_CHECKING, Any

from django.db import IntegrityError, transaction

from apps.customers.models import Customer
from core.responses import ServiceError

if TYPE_CHECKING:
    from apps.tenants.models import Tenant


def create_customer(tenant: "Tenant", **fields: Any) -> Customer:
    """Create a customer; phone unique per tenant when present."""
    customer = Customer(tenant=tenant, **fields)
    try:
        with transaction.atomic():
            customer.save()
    except IntegrityError as exc:
        if "customer_tenant_phone_uniq" in str(exc):
            raise ServiceError(
                "ALREADY_EXISTS", "A customer with this phone number already exists."
            ) from exc
        raise
    return customer


def update_customer(customer: Customer, **fields: Any) -> Customer:
    """Update mutable customer fields (same phone-uniqueness rule)."""
    for name, value in fields.items():
        setattr(customer, name, value)
    try:
        with transaction.atomic():
            customer.save()
    except IntegrityError as exc:
        if "customer_tenant_phone_uniq" in str(exc):
            raise ServiceError(
                "ALREADY_EXISTS", "A customer with this phone number already exists."
            ) from exc
        raise
    return customer


def deactivate_customer(customer: Customer) -> Customer:
    """Master data is deactivated, never hard-deleted (invoice history)."""
    customer.is_active = False
    customer.save(update_fields=["is_active", "updated_at"])
    return customer
