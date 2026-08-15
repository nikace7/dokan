"""API tests for item images — POST/DELETE /catalog/items/{id}/image.

Covers the upload happy path for each accepted format (fixtures are real
images generated with Pillow, so content sniffing sees genuine magic bytes),
the 2 MB cap, type sniffing (a text file named .png must fail), the
catalog.manage gate, replace/clear file lifecycle on disk, tenant isolation,
and image_url on the for-sale dropdown rows.
"""

import io
from decimal import Decimal
from typing import Any

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from apps.accounts.models import Permission
from tests.factories import (
    DEFAULT_PASSWORD,
    BranchFactory,
    ItemFactory,
    ItemVariantFactory,
    RoleFactory,
    RolePermissionFactory,
    StockLevelFactory,
    TenantFactory,
    UserFactory,
    UserRoleFactory,
)

pytestmark = pytest.mark.django_db

SLUG = "shreeganesh"


def host(slug: str = SLUG) -> dict[str, str]:
    return {"HTTP_HOST": f"{slug}.dokan.com.np"}


def image_url(item: Any) -> str:
    return f"/api/v1/catalog/items/{item.pk}/image"


@pytest.fixture(autouse=True)
def media_root(tmp_path: Any, settings: Any) -> None:
    """Each test writes to its own empty media dir."""
    settings.MEDIA_ROOT = tmp_path


@pytest.fixture
def tenant() -> Any:
    return TenantFactory(slug=SLUG)


@pytest.fixture
def user(tenant: Any) -> Any:
    return UserFactory(tenant=tenant)


@pytest.fixture
def item(tenant: Any) -> Any:
    return ItemFactory(tenant=tenant)


def grant(tenant: Any, user: Any, *codes: str) -> None:
    role = RoleFactory(tenant=tenant)
    for code in codes:
        RolePermissionFactory(
            tenant=tenant, role=role, permission=Permission.objects.get(code=code)
        )
    UserRoleFactory(tenant=tenant, user=user, role=role)


def auth_client(user: Any, slug: str = SLUG) -> APIClient:
    tokens = (
        APIClient()
        .post(
            "/api/v1/auth/token",
            {"phone": user.phone, "password": DEFAULT_PASSWORD},
            **host(slug),
        )
        .json()["data"]
    )
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")
    return client


def make_image(fmt: str = "JPEG", name: str = "photo.jpg") -> SimpleUploadedFile:
    """A real image encoded by Pillow — content sniffing sees true magic bytes."""
    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", (8, 8), color=(30, 90, 160)).save(buffer, format=fmt)
    return SimpleUploadedFile(name, buffer.getvalue(), content_type=f"image/{fmt.lower()}")


def stored_path(settings: Any, url: str) -> Any:
    """Map an image_url (/media/...) back to the file inside the test media root."""
    return settings.MEDIA_ROOT / url.removeprefix("/media/")


class TestUpload:
    @pytest.mark.parametrize(
        ("fmt", "name", "extension"),
        [("JPEG", "a.jpg", ".jpg"), ("PNG", "a.png", ".png"), ("WEBP", "a.webp", ".webp")],
    )
    def test_happy_path_accepted_formats(
        self,
        tenant: Any,
        user: Any,
        item: Any,
        settings: Any,
        fmt: str,
        name: str,
        extension: str,
    ) -> None:
        grant(tenant, user, "catalog.manage", "catalog.view")
        response = auth_client(user).post(
            image_url(item), {"image": make_image(fmt, name)}, format="multipart", **host()
        )
        assert response.status_code == 200
        url = response.json()["data"]["image_url"]
        assert url.startswith(f"/media/tenants/{tenant.pk}/items/")
        assert url.endswith(extension)
        assert stored_path(settings, url).is_file()

        item.refresh_from_db()
        assert item.image

        # The detail endpoint reports the same URL.
        detail = auth_client(user).get(f"/api/v1/catalog/items/{item.pk}", **host())
        assert detail.json()["data"]["image_url"] == url

    def test_too_large_rejected(self, tenant: Any, user: Any, item: Any) -> None:
        grant(tenant, user, "catalog.manage")
        big = SimpleUploadedFile(
            "big.jpg", b"\xff\xd8\xff" + b"\x00" * (2 * 1024 * 1024), content_type="image/jpeg"
        )
        response = auth_client(user).post(
            image_url(item), {"image": big}, format="multipart", **host()
        )
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "IMAGE_TOO_LARGE"
        item.refresh_from_db()
        assert not item.image

    def test_fake_png_rejected_by_sniffing(self, tenant: Any, user: Any, item: Any) -> None:
        grant(tenant, user, "catalog.manage")
        fake = SimpleUploadedFile("photo.png", b"just plain text", content_type="image/png")
        response = auth_client(user).post(
            image_url(item), {"image": fake}, format="multipart", **host()
        )
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "IMAGE_TYPE_UNSUPPORTED"
        item.refresh_from_db()
        assert not item.image

    def test_missing_file_field_is_400(self, tenant: Any, user: Any, item: Any) -> None:
        grant(tenant, user, "catalog.manage")
        response = auth_client(user).post(image_url(item), {}, format="multipart", **host())
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "IMAGE_REQUIRED"


class TestPermissions:
    def test_unauthenticated_is_401(self, tenant: Any, item: Any) -> None:
        response = APIClient().post(
            image_url(item), {"image": make_image()}, format="multipart", **host()
        )
        assert response.status_code == 401

    def test_upload_without_catalog_manage_is_403(self, tenant: Any, user: Any, item: Any) -> None:
        grant(tenant, user, "catalog.view")  # read-only permission does not open writes
        response = auth_client(user).post(
            image_url(item), {"image": make_image()}, format="multipart", **host()
        )
        assert response.status_code == 403

    def test_delete_without_catalog_manage_is_403(self, tenant: Any, user: Any, item: Any) -> None:
        grant(tenant, user, "catalog.view")
        response = auth_client(user).delete(image_url(item), **host())
        assert response.status_code == 403


class TestLifecycle:
    def test_replace_deletes_old_file(
        self, tenant: Any, user: Any, item: Any, settings: Any
    ) -> None:
        grant(tenant, user, "catalog.manage")
        client = auth_client(user)
        first = client.post(
            image_url(item), {"image": make_image("JPEG", "one.jpg")}, format="multipart", **host()
        ).json()["data"]["image_url"]
        assert stored_path(settings, first).is_file()

        second = client.post(
            image_url(item), {"image": make_image("PNG", "two.png")}, format="multipart", **host()
        ).json()["data"]["image_url"]
        assert second.endswith(".png")
        assert not stored_path(settings, first).exists()
        assert stored_path(settings, second).is_file()

    def test_clear_removes_file_and_nulls_url(
        self, tenant: Any, user: Any, item: Any, settings: Any
    ) -> None:
        grant(tenant, user, "catalog.manage", "catalog.view")
        client = auth_client(user)
        url = client.post(
            image_url(item), {"image": make_image()}, format="multipart", **host()
        ).json()["data"]["image_url"]
        assert stored_path(settings, url).is_file()

        response = client.delete(image_url(item), **host())
        assert response.status_code == 200
        assert response.json()["data"] == {"id": str(item.pk), "image_url": None}
        assert not stored_path(settings, url).exists()

        item.refresh_from_db()
        assert not item.image
        detail = client.get(f"/api/v1/catalog/items/{item.pk}", **host())
        assert detail.json()["data"]["image_url"] is None


class TestTenantIsolation:
    def test_cross_tenant_upload_and_delete_are_404(self, tenant: Any, user: Any) -> None:
        other_tenant = TenantFactory(slug="other-shop")
        other_item = ItemFactory(tenant=other_tenant)
        grant(tenant, user, "catalog.manage")
        client = auth_client(user)

        response = client.post(
            image_url(other_item), {"image": make_image()}, format="multipart", **host()
        )
        assert response.status_code == 404
        assert client.delete(image_url(other_item), **host()).status_code == 404
        other_item.refresh_from_db()
        assert not other_item.image

    def test_image_url_not_visible_to_other_tenant(
        self, tenant: Any, user: Any, item: Any, settings: Any
    ) -> None:
        grant(tenant, user, "catalog.manage", "catalog.view")
        client = auth_client(user)
        url = client.post(
            image_url(item), {"image": make_image()}, format="multipart", **host()
        ).json()["data"]["image_url"]

        # Tenant B's listing never contains tenant A's items or their URLs.
        other_tenant = TenantFactory(slug="other-shop")
        other_user = UserFactory(tenant=other_tenant)
        grant(other_tenant, other_user, "catalog.view")
        other_client = auth_client(other_user, slug="other-shop")
        listing = other_client.get("/api/v1/catalog/items", **host("other-shop")).json()
        assert listing["meta"]["count"] == 0
        assert url not in str(listing)


class TestForSaleRows:
    def test_for_sale_rows_carry_image_url(
        self, tenant: Any, user: Any, item: Any, settings: Any
    ) -> None:
        branch = BranchFactory(tenant=tenant)
        variant = ItemVariantFactory(tenant=tenant, item=item)
        StockLevelFactory(tenant=tenant, branch=branch, variant=variant, qty_on_hand=Decimal("3"))
        grant(tenant, user, "catalog.manage", "sale.create")
        client = auth_client(user)
        url = client.post(
            image_url(item), {"image": make_image()}, format="multipart", **host()
        ).json()["data"]["image_url"]

        response = client.get(
            "/api/v1/catalog/variants/for-sale", {"branch_id": str(branch.pk)}, **host()
        )
        row = response.json()["data"][0]
        assert row["image_url"] == url
