"""Factories for the storefront app: tenant online-store settings."""

from factory import SubFactory
from factory.django import DjangoModelFactory

from apps.storefront.models import StoreSettings
from tests.factories.tenant import TenantFactory


class StoreSettingsFactory(DjangoModelFactory):
    class Meta:
        model = StoreSettings

    tenant = SubFactory(TenantFactory)
