"""Expense tracking — rent, salary, electricity (design §1.2).

Without expenses, "profit" is only gross margin. These are ordinary CRUD
records (no ledger requirement — expenses are corrections-prone data
entry, unlike invoices); the audit trail for edits/deletes lands with
the audit app.

``ExpenseCategory`` is the lookup the schema sketch left undefined
(`expense.category_id`, docs/DATABASE_SCHEMA.md §9.2): owned here as a
simple tenant-scoped name list — empty by default; shops add their own,
seed_demo adds a starter set.
"""

import uuid
from typing import ClassVar

from django.db import models

from core.models import TenantScopedModel


class ExpenseCategory(TenantScopedModel):
    """A tenant's own expense buckets (Rent, Salary, Electricity, …)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.TextField()
    name_np = models.TextField(null=True, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "expense_category"
        constraints = [
            models.UniqueConstraint(fields=["tenant", "name"], name="expense_category_name_uniq")
        ]

    def __str__(self) -> str:
        return self.name


class Expense(TenantScopedModel):
    """One expense. branch NULL = tenant-wide (rent typically)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    branch = models.ForeignKey(
        "tenants.Branch", on_delete=models.PROTECT, related_name="+", null=True, blank=True
    )
    category = models.ForeignKey(ExpenseCategory, on_delete=models.PROTECT, related_name="expenses")
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    payee = models.TextField(null=True, blank=True)  # vendor/payee, free text
    note = models.TextField(null=True, blank=True)
    business_date_ad = models.DateField()
    business_date_bs = models.CharField(max_length=10)
    fiscal_year_bs = models.CharField(max_length=7)
    created_by = models.ForeignKey("accounts.User", on_delete=models.PROTECT, related_name="+")

    class Meta:
        db_table = "expense"
        indexes: ClassVar = [
            models.Index(fields=["tenant", "business_date_bs"], name="expense_tenant_date_idx"),
            models.Index(fields=["tenant", "category"], name="expense_tenant_category_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.category.name} {self.amount} ({self.business_date_bs})"
