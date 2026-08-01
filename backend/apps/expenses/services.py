"""Write-side business logic for expenses — ordinary CRUD, no ledger."""

from datetime import date
from decimal import Decimal
from typing import TYPE_CHECKING, Any

from django.db import IntegrityError, transaction

from apps.expenses.models import Expense, ExpenseCategory
from core.calendar.bs import ad_to_bs, fiscal_year_bs
from core.money import quantize_money
from core.responses import ServiceError

if TYPE_CHECKING:
    from apps.accounts.models import User
    from apps.tenants.models import Tenant


def create_category(tenant: "Tenant", *, name: str, name_np: str | None = None) -> ExpenseCategory:
    """Create a category (name unique per tenant)."""
    category = ExpenseCategory(tenant=tenant, name=name.strip(), name_np=name_np)
    try:
        with transaction.atomic():
            category.save()
    except IntegrityError as exc:
        if "expense_category_name_uniq" in str(exc):
            raise ServiceError(
                "ALREADY_EXISTS", "An expense category with this name already exists."
            ) from exc
        raise
    return category


def update_category(category: ExpenseCategory, **fields: Any) -> ExpenseCategory:
    for name, value in fields.items():
        setattr(category, name, value)
    try:
        with transaction.atomic():
            category.save()
    except IntegrityError as exc:
        if "expense_category_name_uniq" in str(exc):
            raise ServiceError(
                "ALREADY_EXISTS", "An expense category with this name already exists."
            ) from exc
        raise
    return category


def deactivate_category(category: ExpenseCategory) -> ExpenseCategory:
    """Master data deactivates; historical expenses keep the reference."""
    category.is_active = False
    category.save(update_fields=["is_active", "updated_at"])
    return category


def create_expense(
    tenant: "Tenant",
    *,
    branch: Any = None,
    category: ExpenseCategory,
    amount: Decimal,
    business_date_ad: date,
    payee: str = "",
    note: str = "",
    created_by: "User",
) -> Expense:
    """Record one expense (amount > 0; BS dates denormalized at write time)."""
    amount = quantize_money(amount)
    if amount <= Decimal("0"):
        raise ServiceError("AMOUNT_INVALID", "Expense amount must be greater than zero.")
    expense = Expense(
        tenant=tenant,
        branch=branch,
        category=category,
        amount=amount,
        payee=payee or None,
        note=note or None,
        business_date_ad=business_date_ad,
        business_date_bs=ad_to_bs(business_date_ad),
        fiscal_year_bs=fiscal_year_bs(business_date_ad),
        created_by=created_by,
    )
    expense.save()
    return expense


def update_expense(tenant: "Tenant", expense: Expense, **fields: Any) -> Expense:
    """Ordinary edit (no ledger). BS dates follow business_date_ad changes."""
    if "amount" in fields:
        amount = quantize_money(fields["amount"])
        if amount <= Decimal("0"):
            raise ServiceError("AMOUNT_INVALID", "Expense amount must be greater than zero.")
        fields["amount"] = amount
    if "business_date_ad" in fields:
        new_date = fields["business_date_ad"]
        fields["business_date_bs"] = ad_to_bs(new_date)
        fields["fiscal_year_bs"] = fiscal_year_bs(new_date)
    for name, value in fields.items():
        setattr(expense, name, value)
    expense.save()
    return expense


def delete_expense(tenant: "Tenant", expense: Expense) -> None:
    """Hard delete — expenses are data-entry records, not invoices.
    The audit trail for deletes lands with the audit app (documented)."""
    expense.delete()
