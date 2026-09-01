"""Rate-type lifecycle services, split from money-critical price resolution."""

from typing import TYPE_CHECKING, Any

from django.db import IntegrityError, transaction

from apps.pricing.models import RateType
from apps.tenants.services import enforce_creation_limit, require_plan_feature
from core.responses import ServiceError

if TYPE_CHECKING:
    from apps.accounts.models import User
    from apps.tenants.models import Tenant


def create_rate_type(tenant: "Tenant", *, user: "User", **fields: Any) -> RateType:
    """Create a rate type while preserving one default per tenant."""
    with transaction.atomic():
        require_plan_feature(tenant, "custom_rate_types")
        enforce_creation_limit(
            tenant,
            key="max_rate_types",
            namespace="features",
            queryset=RateType.objects.filter(tenant=tenant, is_active=True),
            label="active rate types",
        )
        if fields.get("required_permission"):
            fields["required_permission"] = _get_permission(fields["required_permission"])
        if fields.get("is_default"):
            _unset_default(tenant)
        rate_type = RateType(tenant=tenant, **fields)
        try:
            rate_type.save()
        except IntegrityError as exc:
            if "rate_type_tenant_code_uniq" in str(exc):
                raise ServiceError(
                    "ALREADY_EXISTS", "A rate type with this code already exists."
                ) from exc
            raise
    return rate_type


def update_rate_type(tenant: "Tenant", rate_type: RateType, **fields: Any) -> RateType:
    """Update a rate type; making it default unsets the previous default."""
    if fields.get("required_permission"):
        fields["required_permission"] = _get_permission(fields["required_permission"])
    with transaction.atomic():
        if fields.get("is_default") and not rate_type.is_default:
            _unset_default(tenant)
        for name, value in fields.items():
            setattr(rate_type, name, value)
        try:
            rate_type.save()
        except IntegrityError as exc:
            if "rate_type_tenant_code_uniq" in str(exc):
                raise ServiceError(
                    "ALREADY_EXISTS", "A rate type with this code already exists."
                ) from exc
            raise
    return rate_type


def deactivate_rate_type(rate_type: RateType) -> RateType:
    """Soft-delete only because historical invoices reference rate types."""
    if rate_type.is_default:
        raise ServiceError("RATE_TYPE_IN_USE", "The default rate type cannot be deactivated.")
    rate_type.is_active = False
    rate_type.save(update_fields=["is_active", "updated_at"])
    return rate_type


def get_default_rate_type(tenant: "Tenant") -> RateType:
    """Return the tenant's active default rate type."""
    rate_type = RateType.objects.filter(tenant=tenant, is_default=True, is_active=True).first()
    if rate_type is None:
        raise ServiceError(
            "RATE_TYPE_NOT_FOUND", "No default rate type is configured.", http_status=404
        )
    return rate_type


def _unset_default(tenant: "Tenant") -> None:
    RateType.objects.filter(tenant=tenant, is_default=True).update(is_default=False)


def _get_permission(code: Any) -> Any:
    from apps.accounts.models import Permission

    permission = Permission.objects.filter(code=str(code)).first()
    if permission is None:
        raise ServiceError(
            "PERMISSION_NOT_FOUND", f"Unknown permission codename: {code}.", http_status=400
        )
    return permission
