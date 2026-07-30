"""URL routes for customers."""

from django.urls import path

from apps.customers.views import CustomerDetailView, CustomerListView

app_name = "customers"

urlpatterns = [
    path("customers", CustomerListView.as_view(), name="customer-list"),
    path("customers/<uuid:pk>", CustomerDetailView.as_view(), name="customer-detail"),
]
