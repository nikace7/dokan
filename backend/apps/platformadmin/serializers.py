"""Shape validation and SimpleJWT refresh plumbing for platform auth."""

from typing import Any

from rest_framework import serializers
from rest_framework.exceptions import AuthenticationFailed, PermissionDenied
from rest_framework_simplejwt.serializers import TokenRefreshSerializer

from apps.accounts.models import User
from apps.accounts.tokens import AUDIENCE_PLATFORM
from apps.platformadmin.models import ImpersonationSession, PlatformAuditLog, PlatformUser
from apps.platformadmin.tokens import PlatformRefreshToken
from apps.tenants.constants import TenantStatus
from apps.tenants.models import (
    Plan,
    Tenant,
    TenantFeatureOverride,
    TenantSubscription,
    TenantUsageSnapshot,
)


class PlatformLoginSerializer(serializers.Serializer):
    email = serializers.EmailField(max_length=254)
    password = serializers.CharField(max_length=128, write_only=True, trim_whitespace=False)
    otp = serializers.RegexField(r"^[0-9]{6}$", write_only=True)


class PlatformMeSerializer(serializers.ModelSerializer):
    class Meta:
        model = PlatformUser
        fields = ("id", "email", "full_name", "role")
        read_only_fields = fields


class PlatformTokenRefreshSerializer(TokenRefreshSerializer):
    token_class = PlatformRefreshToken

    def validate(self, attrs: dict[str, Any]) -> dict[str, str]:
        refresh = self.token_class(attrs["refresh"])
        if refresh.get("aud") != AUDIENCE_PLATFORM or refresh.get("token_use") != "refresh":
            raise PermissionDenied(detail="This token is not valid here.", code="REALM_MISMATCH")
        if not PlatformUser.objects.filter(pk=refresh.get("sub"), is_active=True).exists():
            raise AuthenticationFailed(
                "No active platform account was found.",
                code="no_active_account",
            )
        return super().validate(attrs)


class PlanSerializer(serializers.ModelSerializer):
    class Meta:
        model = Plan
        fields = (
            "id",
            "code",
            "name",
            "price_npr",
            "billing_cycle",
            "limits",
            "features",
            "is_active",
            "sort_order",
        )
        read_only_fields = fields


class PlanCreateSerializer(serializers.Serializer):
    code = serializers.CharField(max_length=32)
    name = serializers.CharField(max_length=200)
    price_npr = serializers.DecimalField(max_digits=14, decimal_places=2)
    billing_cycle = serializers.ChoiceField(choices=Plan.BillingCycle.choices)
    limits = serializers.JSONField()
    features = serializers.JSONField()
    is_active = serializers.BooleanField(default=True)
    sort_order = serializers.IntegerField(default=0)


class PlanUpdateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=200, required=False)
    price_npr = serializers.DecimalField(max_digits=14, decimal_places=2, required=False)
    billing_cycle = serializers.ChoiceField(choices=Plan.BillingCycle.choices, required=False)
    limits = serializers.JSONField(required=False)
    features = serializers.JSONField(required=False)
    is_active = serializers.BooleanField(required=False)
    sort_order = serializers.IntegerField(required=False)


class TenantSerializer(serializers.ModelSerializer):
    plan_code = serializers.CharField(source="plan.code", read_only=True)
    plan_name = serializers.CharField(source="plan.name", read_only=True)

    class Meta:
        model = Tenant
        fields = (
            "id",
            "slug",
            "name",
            "name_np",
            "legal_name",
            "pan_vat_no",
            "vat_registered",
            "plan",
            "plan_code",
            "plan_name",
            "status",
            "trial_ends_at",
            "timezone",
            "calendar_pref",
            "locale",
            "currency",
            "shopfront_subdomain",
            "onboarded_at",
            "created_at",
        )
        read_only_fields = fields


class TenantCreateSerializer(serializers.Serializer):
    slug = serializers.CharField(max_length=30)
    name = serializers.CharField(max_length=200)
    name_np = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    legal_name = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    pan_vat_no = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    vat_registered = serializers.BooleanField(default=False)
    plan = serializers.PrimaryKeyRelatedField(queryset=Plan.objects.all())
    status = serializers.ChoiceField(choices=TenantStatus.CHOICES, default=TenantStatus.TRIAL)
    trial_ends_at = serializers.DateTimeField(required=False, allow_null=True)
    calendar_pref = serializers.ChoiceField(
        choices=Tenant.CalendarPref.choices,
        default=Tenant.CalendarPref.BS,
    )
    locale = serializers.ChoiceField(choices=Tenant.Locale.choices, default=Tenant.Locale.NP)
    currency = serializers.ChoiceField(
        choices=Tenant.Currency.choices,
        default=Tenant.Currency.NPR,
    )
    owner_phone = serializers.CharField(max_length=32)
    owner_full_name = serializers.CharField(max_length=200)
    owner_email = serializers.EmailField(required=False, allow_blank=True, allow_null=True)
    owner_password = serializers.CharField(
        min_length=12,
        max_length=128,
        write_only=True,
        trim_whitespace=False,
    )
    branch_code = serializers.CharField(max_length=32, default="MAIN")
    branch_name = serializers.CharField(max_length=200, default="Main Branch")


class TenantUpdateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=200, required=False)
    name_np = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    legal_name = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    pan_vat_no = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    vat_registered = serializers.BooleanField(required=False)
    plan = serializers.PrimaryKeyRelatedField(queryset=Plan.objects.all(), required=False)
    status = serializers.ChoiceField(choices=TenantStatus.CHOICES, required=False)
    trial_ends_at = serializers.DateTimeField(required=False, allow_null=True)
    calendar_pref = serializers.ChoiceField(choices=Tenant.CalendarPref.choices, required=False)
    locale = serializers.ChoiceField(choices=Tenant.Locale.choices, required=False)
    currency = serializers.ChoiceField(choices=Tenant.Currency.choices, required=False)
    shopfront_subdomain = serializers.CharField(
        required=False, allow_null=True, allow_blank=True, max_length=30
    )


class SubscriptionSerializer(serializers.ModelSerializer):
    plan_code = serializers.CharField(source="plan.code", read_only=True)

    class Meta:
        model = TenantSubscription
        fields = (
            "id",
            "tenant",
            "plan",
            "plan_code",
            "period_start",
            "period_end",
            "amount_npr",
            "status",
            "payment_ref",
            "invoice_url",
        )
        read_only_fields = fields


class SubscriptionCreateSerializer(serializers.Serializer):
    plan = serializers.PrimaryKeyRelatedField(queryset=Plan.objects.all())
    period_start = serializers.DateField()
    period_end = serializers.DateField()
    amount_npr = serializers.DecimalField(max_digits=14, decimal_places=2)
    status = serializers.ChoiceField(
        choices=TenantSubscription.Status.choices,
        default=TenantSubscription.Status.PENDING,
    )
    payment_ref = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    invoice_url = serializers.URLField(required=False, allow_blank=True, allow_null=True)


class SubscriptionUpdateSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=TenantSubscription.Status.choices, required=False)
    payment_ref = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    invoice_url = serializers.URLField(required=False, allow_blank=True, allow_null=True)


class UsageSnapshotSerializer(serializers.ModelSerializer):
    class Meta:
        model = TenantUsageSnapshot
        fields = ("id", "date", "users", "items", "invoices_mtd", "storage_mb", "sms_used")
        read_only_fields = fields


class FeatureOverrideSerializer(serializers.ModelSerializer):
    class Meta:
        model = TenantFeatureOverride
        fields = ("id", "key", "value", "expires_at", "note")
        read_only_fields = fields


class FeatureOverrideSetSerializer(serializers.Serializer):
    key = serializers.CharField(max_length=200)
    value = serializers.JSONField()
    expires_at = serializers.DateTimeField(required=False, allow_null=True)
    note = serializers.CharField(required=False, allow_blank=True, allow_null=True)


class PlatformAuditSerializer(serializers.ModelSerializer):
    platform_user = serializers.UUIDField(source="actor_id", read_only=True)
    platform_user_name = serializers.CharField(source="actor.full_name", read_only=True)

    class Meta:
        model = PlatformAuditLog
        fields = (
            "id",
            "platform_user",
            "platform_user_name",
            "action",
            "tenant",
            "payload",
            "ip",
            "created_at",
        )
        read_only_fields = fields


class ImpersonationStartSerializer(serializers.Serializer):
    target_user = serializers.UUIDField()
    reason = serializers.CharField(max_length=1000, trim_whitespace=True)
    scope = serializers.CharField(default=ImpersonationSession.Scope.READ_ONLY, max_length=10)
    duration_minutes = serializers.IntegerField(default=15)


class ImpersonationTargetSerializer(serializers.ModelSerializer):
    """Minimal tenant identity exposed to support for target selection."""

    class Meta:
        model = User
        fields = ("id", "phone", "full_name")
        read_only_fields = fields


class ImpersonationSessionSerializer(serializers.ModelSerializer):
    platform_user_name = serializers.CharField(source="platform_user.full_name", read_only=True)

    class Meta:
        model = ImpersonationSession
        fields = (
            "id",
            "platform_user",
            "platform_user_name",
            "tenant",
            "target_user_id",
            "reason",
            "scope",
            "started_at",
            "expires_at",
            "ended_at",
            "ended_by",
        )
        read_only_fields = fields
