"""URL routes for expenses."""

from django.urls import path

from apps.expenses.views import (
    CategoryDetailView,
    CategoryListView,
    ExpenseDetailView,
    ExpenseListView,
    ExpenseSummaryView,
)

app_name = "expenses"

urlpatterns = [
    path("expenses/categories", CategoryListView.as_view(), name="category-list"),
    path("expenses/categories/<uuid:pk>", CategoryDetailView.as_view(), name="category-detail"),
    path("expenses", ExpenseListView.as_view(), name="expense-list"),
    path("expenses/summary", ExpenseSummaryView.as_view(), name="expense-summary"),
    path("expenses/<uuid:pk>", ExpenseDetailView.as_view(), name="expense-detail"),
]
