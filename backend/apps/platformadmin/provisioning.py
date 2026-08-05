"""Atomic tenant provisioning for the isolated platform control plane."""

from typing import TYPE_CHECKING

from django.db import connection, transaction

from apps.accounts.provisioning import provision_owner
from apps.platformadmin.audit import audit_platform
from apps.platformadmin.models import PlatformUser
from apps.platformadmin.permissions import require_platform_role
from apps.pricing.provisioning import provision_default_rate_type
from apps.tenants import services as tenant_services
from apps.tenants.constants import TenantStatus
from core.db.rls import set_local_tenant

if TYPE_CHECKING:
    from datetime import datetime

    from django.http import HttpRequest

    from apps.tenants.models import Plan, Tenant


@transaction.atomic
def provision_tenant(
    *,
    actor: PlatformUser,
    plan: "Plan",
    slug: str,
    name: str,
    owner_phone: str,
    owner_full_name: str,
    owner_password: str,
    branch_code: str,
    branch_name: str,
    status: str = TenantStatus.TRIAL,
    trial_ends_at: "datetime | None" = None,
    name_np: str | None = None,
    legal_name: str | None = None,
    pan_vat_no: str | None = None,
    vat_registered: bool = False,
    calendar_pref: str = "BS",
    locale: str = "np",
    owner_email: str | None = None,
    request: "HttpRequest | None" = None,
) -> "Tenant":
    """Create a shop that can log in and issue its first bill."""
    require_platform_role(actor, (PlatformUser.Role.SUPER_ADMIN,))
    tenant = tenant_services.create_platform_tenant(
        plan=plan,
        slug=slug,
        name=name,
        name_np=name_np,
        legal_name=legal_name,
        pan_vat_no=pan_vat_no,
        vat_registered=vat_registered,
        status=status,
        trial_ends_at=trial_ends_at,
        calendar_pref=calendar_pref,
        locale=locale,
    )
    # Platform requests have no tenant middleware context. Set it locally so
    # RLS protects every tenant-scoped provisioning write.
    set_local_tenant(connection, tenant.pk)
    branch = tenant_services.create_default_branch(
        tenant,
        code=branch_code,
        name=branch_name,
    )
    owner = provision_owner(
        tenant,
        phone=owner_phone,
        full_name=owner_full_name,
        password=owner_password,
        email=owner_email,
    )
    provision_default_rate_type(tenant)
    # ponytail: number rows are intentionally lazy; allocate_number creates
    # each branch/fiscal-year series atomically on its first document.
    audit_platform(
        actor=actor,
        action="tenant.provision",
        tenant=tenant,
        payload={
            "after": {
                "slug": tenant.slug,
                "name": tenant.name,
                "plan": plan.code,
                "status": tenant.status,
                "owner": str(owner.pk),
                "branch": str(branch.pk),
            }
        },
        request=request,
    )
    return tenant
