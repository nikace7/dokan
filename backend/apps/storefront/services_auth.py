"""Email-OTP login for online shoppers — no passwords, ever.

Flow: the shopper enters their email, we mail a 6-digit code (hashed at
rest, 10-minute TTL, single-use, 5 attempts), and a correct code mints a
signed 30-day customer token. A first-time email auto-creates the
``StoreCustomer`` row — registration is implicit, per the storefront's
"account on first order" rule.
"""

import hashlib
import secrets
from datetime import timedelta
from typing import TYPE_CHECKING

from django.core import signing
from django.core.mail import send_mail
from django.utils import timezone

from apps.storefront.models import StoreCustomer, StoreOtp
from core.responses import ServiceError

if TYPE_CHECKING:
    from apps.tenants.models import Tenant

OTP_TTL = timedelta(minutes=10)
OTP_MAX_ATTEMPTS = 5
OTP_RESEND_COOLDOWN = timedelta(seconds=60)

CUSTOMER_TOKEN_SALT = "storefront.customer.v1"
CUSTOMER_TOKEN_MAX_AGE = 30 * 24 * 60 * 60  # 30 days, seconds


def _hash_code(tenant: "Tenant", email: str, code: str) -> str:
    """Salted hash — a leaked OTP table row never reveals a usable code."""
    from django.conf import settings

    raw = f"{settings.SECRET_KEY}:{tenant.pk}:{email.lower()}:{code}"
    return hashlib.sha256(raw.encode()).hexdigest()


def request_otp(tenant: "Tenant", *, email: str) -> None:
    """Issue and email a fresh login code, honoring a 60s resend cooldown."""
    email = email.strip().lower()
    latest = (
        StoreOtp.objects.filter(tenant=tenant, email=email, consumed_at__isnull=True)
        .order_by("-created_at")
        .first()
    )
    if latest is not None and timezone.now() - latest.created_at < OTP_RESEND_COOLDOWN:
        raise ServiceError(
            "OTP_RESEND_TOO_SOON",
            "A code was just sent — please wait a minute before asking for another.",
            http_status=429,
        )
    code = f"{secrets.randbelow(1_000_000):06d}"
    StoreOtp.objects.create(
        tenant=tenant,
        email=email,
        code_hash=_hash_code(tenant, email, code),
        expires_at=timezone.now() + OTP_TTL,
    )
    send_mail(
        subject=f"{code} is your {tenant.name} login code",
        message=(
            f"Namaste!\n\nYour one-time login code for {tenant.name} is:\n\n"
            f"    {code}\n\nIt expires in 10 minutes. If you did not ask for it, "
            "you can ignore this email.\n"
        ),
        from_email=None,  # DEFAULT_FROM_EMAIL
        recipient_list=[email],
        fail_silently=False,
    )


def verify_otp(tenant: "Tenant", *, email: str, code: str) -> StoreCustomer:
    """Check a code and return the (auto-created) customer it belongs to."""
    email = email.strip().lower()
    otp = (
        StoreOtp.objects.filter(tenant=tenant, email=email, consumed_at__isnull=True)
        .order_by("-created_at")
        .first()
    )
    invalid = ServiceError(
        "OTP_INVALID", "That code is not right — check it and try again.", http_status=400
    )
    if otp is None or otp.expires_at <= timezone.now():
        raise invalid
    if otp.attempts >= OTP_MAX_ATTEMPTS:
        raise ServiceError(
            "OTP_LOCKED",
            "Too many wrong tries — request a fresh code.",
            http_status=429,
        )
    if otp.code_hash != _hash_code(tenant, email, code.strip()):
        otp.attempts += 1
        otp.save(update_fields=["attempts", "updated_at"])
        raise invalid
    otp.consumed_at = timezone.now()
    otp.save(update_fields=["consumed_at", "updated_at"])
    customer, _ = StoreCustomer.objects.get_or_create(tenant=tenant, email=email)
    return customer


def issue_customer_token(customer: StoreCustomer) -> str:
    """Signed, stateless 30-day token binding the customer to this tenant."""
    return signing.dumps(
        {"cid": str(customer.pk), "tid": str(customer.tenant_id)},
        salt=CUSTOMER_TOKEN_SALT,
    )


def resolve_customer_token(tenant: "Tenant", token: str) -> StoreCustomer | None:
    """Validate a customer token; None for bad, expired, or cross-tenant tokens."""
    try:
        payload = signing.loads(
            token, salt=CUSTOMER_TOKEN_SALT, max_age=CUSTOMER_TOKEN_MAX_AGE
        )
    except signing.BadSignature:
        return None
    if not isinstance(payload, dict) or payload.get("tid") != str(tenant.pk):
        return None
    cid = payload.get("cid")
    if not isinstance(cid, str):
        return None
    return StoreCustomer.objects.filter(tenant=tenant, pk=cid).first()
