"""URL routes for purchasing."""

from django.urls import path

from apps.purchasing.views import SupplierDetailView, SupplierListView

app_name = "purchasing"

urlpatterns = [
    path("purchasing/suppliers", SupplierListView.as_view(), name="supplier-list"),
    path("purchasing/suppliers/<uuid:pk>", SupplierDetailView.as_view(), name="supplier-detail"),
]
