"""Seed a demo shop so the project can be tried locally end-to-end.

Creates one tenant (slug ``demo``) with an owner login, a branch, a default
rate type, a small catalog, and opening stock. Idempotent: re-running updates
nothing and reports what already existed. Demo only — never run in prod.

Usage (from backend/):

    python manage.py seed_demo

Then browse http://demo.localhost:8000/api/docs/ (ROOT_DOMAIN=localhost) and
log in with phone 9800000000 / password demo1234.
"""

from decimal import Decimal
from typing import Any

from django.core.management.base import BaseCommand
from django.db import transaction

from apps.accounts.models import Permission, Role, RolePermission, User, UserRole
from apps.catalog.models import Brand, Category, Item, ItemVariant, SizeChart
from apps.expenses.models import ExpenseCategory
from apps.inventory.services import post_opening_stock
from apps.pricing.models import RateType
from apps.storefront.models import StoreSettings
from apps.tenants.models import Branch, Plan, Tenant

DEMO_PHONE = "9800000000"
DEMO_PASSWORD = "demo1234"  # demo credentials for local use only

#: Starter expense buckets for the demo shop (design §1.2).
DEMO_EXPENSE_CATEGORIES = ("Rent", "Salary", "Electricity", "Transport", "Other")


class Command(BaseCommand):
    help = "Seed a demo tenant with an owner login, catalog, and stock (local dev only)."

    def handle(self, *args: Any, **options: Any) -> None:
        with transaction.atomic():
            owner = self._seed()
        self.stdout.write(self.style.SUCCESS("Demo shop ready."))
        self.stdout.write("  URL:      http://demo.localhost:8000/api/docs/")
        self.stdout.write(f"  Login:    phone {DEMO_PHONE} / password {DEMO_PASSWORD}")
        self.stdout.write(f"  Owner:    {owner.full_name}")

    def _seed(self) -> User:
        plan, _ = Plan.objects.update_or_create(
            code="demo",
            defaults={
                "name": "Demo Plan",
                "price_npr": Decimal("0"),
                "billing_cycle": "monthly",
                "limits": {
                    "max_users": 20,
                    "max_branches": 5,
                    "max_items": 5000,
                    "max_invoices_per_month": 10000,
                    "sms_credits_per_month": 1000,
                },
                "features": {
                    # Demo defaults to the simple sale screen; the advanced
                    # barcode POS stays off until the shop asks for it.
                    "simple_sale": True,
                    "advanced_pos": False,
                    "sms": True,
                    "profit_reports": True,
                    "export_excel": True,
                    "custom_rate_types": True,
                    "max_rate_types": 10,
                    "multi_branch": True,
                    "vat_module": True,
                    # Online storefront — off until the shop gets a shopfront
                    # subdomain from the platform admin.
                    "ecommerce": False,
                },
            },
        )
        tenant, _ = Tenant.objects.get_or_create(
            slug="demo",
            defaults={"name": "Demo Store", "plan": plan, "status": "ACTIVE"},
        )
        branch, _ = Branch.objects.get_or_create(
            tenant=tenant,
            code="MAIN",
            defaults={"name": "Main Branch", "is_default": True},
        )

        owner, created = User.objects.get_or_create(
            tenant=tenant,
            phone=DEMO_PHONE,
            defaults={"full_name": "Demo Owner", "is_active": True},
        )
        if created:
            owner.set_password(DEMO_PASSWORD)
            owner.save(update_fields=["password", "updated_at"])

        role, _ = Role.objects.get_or_create(
            tenant=tenant, code="OWNER", defaults={"name": "Owner", "is_system": True}
        )
        for permission in Permission.objects.all():
            RolePermission.objects.get_or_create(tenant=tenant, role=role, permission=permission)
        UserRole.objects.get_or_create(tenant=tenant, user=owner, role=role, branch=None)

        RateType.objects.get_or_create(
            tenant=tenant,
            code="RETAIL",
            defaults={"name": "Retail", "is_default": True, "sort_order": 0},
        )
        chart, _ = SizeChart.objects.get_or_create(
            tenant=tenant, name="Adult", defaults={"values": ["S", "M", "L", "XL"]}
        )
        brand, _ = Brand.objects.get_or_create(tenant=tenant, name="Generic")
        category, _ = Category.objects.get_or_create(
            tenant=tenant, name="Shirts", defaults={"size_chart": chart}
        )
        for expense_category in DEMO_EXPENSE_CATEGORIES:
            ExpenseCategory.objects.get_or_create(tenant=tenant, name=expense_category)

        catalog = [
            # code, name, mrp, cost, website price, per-item offer %, featured
            (
                "TEE-01",
                "Plain T-Shirt",
                Decimal("1500.00"),
                Decimal("600.00"),
                Decimal("1200.00"),
                None,
                True,
            ),
            (
                "SH-01",
                "Oxford Shirt",
                Decimal("2800.00"),
                Decimal("1200.00"),
                Decimal("2200.00"),
                Decimal("15.00"),
                True,
            ),  # own offer beats the store one
            (
                "JW-01",
                "Denim Jacket",
                Decimal("4500.00"),
                Decimal("2200.00"),
                Decimal("3600.00"),
                None,
                False,
            ),
        ]
        for code, name, mrp, cost, website_price, offer_pct, featured in catalog:
            item, _ = Item.objects.get_or_create(
                tenant=tenant,
                code=code,
                defaults={
                    "name": name,
                    "category": category,
                    "brand": brand,
                    "size_chart": chart,
                    "website_price": website_price,
                    "website_discount_pct": offer_pct,
                    "website_featured": featured,
                    "created_by": owner,
                },
            )
            for size in ("M", "L"):
                variant, variant_created = ItemVariant.objects.get_or_create(
                    tenant=tenant,
                    item=item,
                    size=size,
                    color="Black",
                    defaults={"sku": f"{code}-{size}-BLACK", "mrp": mrp},
                )
                if variant_created:
                    post_opening_stock(
                        tenant,
                        branch=branch,
                        variant=variant,
                        qty=Decimal("20"),
                        unit_cost=cost,
                        created_by=owner,
                        note="Demo seed",
                    )

        # Demo online-store content: a visible offer + popup + banners +
        # website prices (set on the items above) so the storefront shows the
        # full feature set.
        StoreSettings.objects.get_or_create(
            tenant=tenant,
            defaults={
                "announcement": "Free delivery inside Kathmandu valley",
                "offer_text": "Dashain Sale",
                "offer_discount_pct": Decimal("10.00"),
                "popup_enabled": True,
                "popup_title": "Dashain Sale is live",
                "popup_text": "10% off all website prices — plus free delivery "
                "inside Kathmandu valley.",
                "popup_cta_text": "Shop the sale",
                "popup_cta_link": "#shop",
                "banners": [
                    {
                        "title": "Free delivery",
                        "text": "On every order inside Kathmandu valley.",
                        "cta_text": "",
                        "cta_link": "",
                    },
                    {
                        "title": "New arrivals",
                        "text": "Fresh shirts and jackets for the season.",
                        "cta_text": "Browse the collection",
                        "cta_link": "#shop",
                    },
                ],
                "currency": "NPR",
            },
        )
        return owner
