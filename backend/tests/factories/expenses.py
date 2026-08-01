"""Factories for expenses: categories and expenses."""

from datetime import date
from decimal import Decimal

from factory import LazyAttribute, LazyFunction, SelfAttribute, Sequence, SubFactory
from factory.django import DjangoModelFactory

from apps.expenses.models import Expense, ExpenseCategory
from core.calendar.bs import ad_to_bs, fiscal_year_bs
from tests.factories.accounts import UserFactory
from tests.factories.branch import BranchFactory
from tests.factories.tenant import TenantFactory


class ExpenseCategoryFactory(DjangoModelFactory):
    class Meta:
        model = ExpenseCategory

    tenant = SubFactory(TenantFactory)
    name = Sequence(lambda n: f"Category {n}")


class ExpenseFactory(DjangoModelFactory):
    class Meta:
        model = Expense

    tenant = SubFactory(TenantFactory)
    branch = SubFactory(BranchFactory, tenant=SelfAttribute("..tenant"))
    category = SubFactory(ExpenseCategoryFactory, tenant=SelfAttribute("..tenant"))
    amount = Decimal("1000.00")
    created_by = SubFactory(UserFactory, tenant=SelfAttribute("..tenant"))

    business_date_ad = LazyFunction(date.today)
    business_date_bs = LazyAttribute(lambda o: ad_to_bs(o.business_date_ad))
    fiscal_year_bs = LazyAttribute(lambda o: fiscal_year_bs(o.business_date_ad))
