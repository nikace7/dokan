"""Write-side business logic for suppliers."""

from typing import TYPE_CHECKING, Any

from apps.purchasing.models import Supplier

if TYPE_CHECKING:
    from apps.tenants.models import Tenant


def create_supplier(tenant: "Tenant", **fields: Any) -> Supplier:
    """Create a supplier (name is not unique — real vendors repeat)."""
    supplier = Supplier(tenant=tenant, **fields)
    supplier.save()
    return supplier


def update_supplier(supplier: Supplier, **fields: Any) -> Supplier:
    for name, value in fields.items():
        setattr(supplier, name, value)
    supplier.save()
    return supplier


def deactivate_supplier(supplier: Supplier) -> Supplier:
    """Master data is deactivated, never hard-deleted (invoice history)."""
    supplier.is_active = False
    supplier.save(update_fields=["is_active", "updated_at"])
    return supplier
