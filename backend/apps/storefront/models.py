"""Tenant-owned online-store settings (one row per tenant).

The public storefront (``*.shop.<root>``) reads these to render dynamic
content the shop controls itself: hero copy, an announcement strip, a
schedulable store-wide offer with a discount percentage, an offer popup,
promo banner cards, and the currency website prices are entered and
displayed in. The template and the store address stay platform-admin
decisions (``Tenant.shopfront_template`` / ``shopfront_subdomain``);
everything here is tenant-admin territory.
"""

import uuid
from typing import ClassVar

from django.core.validators import MinValueValidator
from django.db import models

from core.models import TenantScopedModel
from core.money import CURRENCY_INR, CURRENCY_NPR
from core.money import MAX_OFFER_PCT as MAX_OFFER_PCT  # explicit re-export

CURRENCY_CHOICES = ((CURRENCY_NPR, "NPR"), (CURRENCY_INR, "INR"))

#: Banners are small promo cards rendered between the hero and the grid.
MAX_BANNERS = 5


class StoreSettings(TenantScopedModel):
    """Editable website content + pricing knobs for a tenant's online store."""

    hero_title = models.TextField(blank=True, default="")
    hero_subtitle = models.TextField(blank=True, default="")
    announcement = models.TextField(blank=True, default="")
    offer_text = models.TextField(blank=True, default="")
    offer_discount_pct = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[MinValueValidator(0)],
    )
    #: Optional last day of the store-wide offer; a lapsed offer stops
    #: discounting and disappears from the storefront automatically.
    offer_ends_at = models.DateField(null=True, blank=True)
    #: Offer popup — a once-per-visitor-session modal with a call to action.
    popup_enabled = models.BooleanField(default=False)
    popup_title = models.TextField(blank=True, default="")
    popup_text = models.TextField(blank=True, default="")
    popup_cta_text = models.TextField(blank=True, default="")
    #: Anchor ("#shop"), site path, or absolute URL the popup CTA points to.
    popup_cta_link = models.TextField(blank=True, default="")
    #: Promo banner cards: [{title, text, cta_text, cta_link}], max MAX_BANNERS.
    banners = models.JSONField(null=True, blank=True)
    #: Currency website prices are entered in and the storefront displays.
    #: May differ from the tenant's counter currency — the public grid then
    #: converts the selling-price range at the NPR/INR peg for display.
    currency = models.CharField(max_length=3, choices=CURRENCY_CHOICES, default=CURRENCY_NPR)

    class Meta:
        db_table = "store_settings"
        constraints = [
            models.UniqueConstraint(fields=["tenant"], name="store_settings_tenant_uniq")
        ]

    def __str__(self) -> str:
        return f"Store settings ({self.tenant_id})"


class StoreCustomer(TenantScopedModel):
    """An online shopper, identified by email. Rows are auto-created on first
    OTP login — there is no registration form and no password.
    Separate from ``accounts.User`` (shop staff) and ``customers.Customer``
    (the udharo khata). The optional link is created when staff prepares the
    shopper's first order as a POS bill."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField()
    full_name = models.TextField(blank=True, default="")
    phone = models.TextField(blank=True, default="")
    #: Last delivery address, so the next checkout comes pre-filled.
    default_address = models.JSONField(null=True, blank=True)
    ledger_customer = models.ForeignKey(
        "customers.Customer",
        on_delete=models.SET_NULL,
        related_name="+",
        null=True,
        blank=True,
    )

    class Meta:
        db_table = "store_customer"
        constraints = [
            models.UniqueConstraint(fields=["tenant", "email"], name="store_customer_email_uniq")
        ]

    def __str__(self) -> str:
        return self.email


class StoreOtp(TenantScopedModel):
    """One-time login code. Stored hashed, short-lived, single-use, and
    attempt-capped — the customer never has a password to remember."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField()
    code_hash = models.CharField(max_length=64)
    expires_at = models.DateTimeField()
    attempts = models.IntegerField(default=0)
    consumed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "store_otp"
        indexes: ClassVar = [
            models.Index(fields=["tenant", "email", "created_at"], name="store_otp_email_idx"),
        ]


class StoreOrder(TenantScopedModel):
    """An online order. Stock and money stay untouched at placement: the shop
    confirms the order in the POS (posting the SALE through the existing
    pipeline) and records COD collection on handover. ``number_text`` is the
    customer-facing number from the gapless per-branch numbering series."""

    class Status(models.TextChoices):
        PLACED = "PLACED"
        CONFIRMED = "CONFIRMED"
        PACKED = "PACKED"
        SHIPPED = "SHIPPED"
        DELIVERED = "DELIVERED"
        CANCELLED = "CANCELLED"

    class Fulfillment(models.TextChoices):
        DELIVERY = "DELIVERY"
        PICKUP = "PICKUP"

    class PaymentMethod(models.TextChoices):
        COD = "COD"
        ONLINE = "ONLINE"

    class PaymentStatus(models.TextChoices):
        PENDING = "PENDING"
        PAID = "PAID"
        REFUNDED = "REFUNDED"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    branch = models.ForeignKey(
        "tenants.Branch", on_delete=models.PROTECT, related_name="+"
    )  # fulfilling branch — the default branch at checkout
    customer = models.ForeignKey(StoreCustomer, on_delete=models.PROTECT, related_name="orders")
    sales_invoice = models.OneToOneField(
        "sales.SalesInvoice",
        on_delete=models.PROTECT,
        related_name="store_order",
        null=True,
        blank=True,
    )
    order_number = models.IntegerField()
    number_text = models.TextField()
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PLACED)
    fulfillment = models.CharField(max_length=10, choices=Fulfillment.choices)
    payment_method = models.CharField(max_length=10, choices=PaymentMethod.choices)
    payment_status = models.CharField(
        max_length=10, choices=PaymentStatus.choices, default=PaymentStatus.PENDING
    )
    #: Delivery address snapshot ({line1, city, area, landmark, lat, lng, note});
    #: NULL for store pickup. Snapshotted so later profile edits don't rewrite it.
    address = models.JSONField(null=True, blank=True)
    currency = models.CharField(max_length=3, choices=CURRENCY_CHOICES)
    subtotal = models.DecimalField(max_digits=14, decimal_places=2)
    total = models.DecimalField(max_digits=14, decimal_places=2)
    #: Offer label at order time (e.g. "Winter Sale · 15%"), "" when none ran.
    offer_text = models.TextField(blank=True, default="")
    #: Unguessable public tracking link token (like the shared-bill token).
    tracking_token = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    idempotency_key = models.TextField(null=True, blank=True)
    note = models.TextField(blank=True, default="")
    business_date_ad = models.DateField()
    business_date_bs = models.CharField(max_length=10)
    fiscal_year_bs = models.CharField(max_length=7)

    class Meta:
        db_table = "store_order"
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "branch", "fiscal_year_bs", "order_number"],
                name="store_order_number_uniq",
            ),
            models.UniqueConstraint(
                fields=["tenant", "idempotency_key"],
                condition=models.Q(idempotency_key__isnull=False),
                name="store_order_idem_uniq",
            ),
        ]
        indexes: ClassVar = [
            models.Index(fields=["tenant", "customer", "created_at"], name="store_order_cust_idx"),
            models.Index(fields=["tenant", "status", "created_at"], name="store_order_status_idx"),
        ]

    def __str__(self) -> str:
        return self.number_text


class StoreOrderItem(TenantScopedModel):
    """One ordered line. Catalog fields are snapshotted so later edits to the
    item or its prices never rewrite a customer's order history."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.ForeignKey(StoreOrder, on_delete=models.CASCADE, related_name="items")
    variant = models.ForeignKey("catalog.ItemVariant", on_delete=models.PROTECT, related_name="+")
    name = models.TextField()
    size = models.TextField()
    color = models.TextField()
    #: Charged unit price in the order's currency (discounted website price).
    unit_price = models.DecimalField(max_digits=14, decimal_places=2)
    #: Pre-discount website price while an offer ran, for display only.
    compare_at = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    qty = models.DecimalField(max_digits=12, decimal_places=3)
    line_total = models.DecimalField(max_digits=14, decimal_places=2)

    class Meta:
        db_table = "store_order_item"
        indexes: ClassVar = [
            models.Index(fields=["tenant", "order"], name="store_order_item_order_idx"),
        ]
