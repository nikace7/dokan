"""Write-side business logic for catalog — one service function, one transaction.

Validation that touches the database or invariants lives here, never in
serializers: category cycle guard, min≤max price bounds, friendly uniqueness
errors, the size×colour matrix bulk entry, deactivate-not-delete semantics.
Item image uploads are validated by content (Pillow sniffing), never by the
client-supplied filename or Content-Type header.
"""

from decimal import Decimal
from typing import IO, TYPE_CHECKING, Any
from uuid import UUID

from django.db import IntegrityError, transaction

from apps.catalog.barcodes import BarcodeValidationError, validate_barcode
from apps.catalog.models import Brand, Category, Item, ItemVariant, SizeChart
from apps.tenants.services import enforce_creation_limit
from core.responses import ServiceError

if TYPE_CHECKING:
    from apps.accounts.models import User
    from apps.tenants.models import Tenant

_MAX_TREE_WALK = 100  # sanity bound for the ancestry walk


def validate_price_bounds(min_price: Decimal | None, max_price: Decimal | None) -> None:
    """When both bounds are set, min must not exceed max."""
    if min_price is not None and max_price is not None and min_price > max_price:
        raise ServiceError(
            "PRICE_BOUNDS_INVALID",
            "Minimum selling price cannot be higher than maximum selling price.",
        )


def _get_for_tenant(model: Any, tenant: "Tenant", ref: Any, what: str) -> Any:
    """Tenant-scoped fetch — a cross-tenant FK reference is a 404, not a leak.

    ``ref`` may be a UUID (internal callers) or an already-deserialized model
    instance (DRF's PrimaryKeyRelatedField in validated_data).
    """
    if isinstance(ref, model):
        instance = ref if ref.tenant_id == tenant.pk else None
    else:
        instance = model.objects.filter(tenant=tenant, pk=ref).first()
    if instance is None:
        raise ServiceError(f"{what.upper()}_NOT_FOUND", f"{what} not found.", http_status=404)
    return instance


def _save_with_friendly_uniqueness(instance: Any, friendly: dict[str, str]) -> None:
    """Save, converting integrity violations into field-level ServiceErrors.

    ``friendly`` maps a substring of the constraint name to a message, e.g.
    {"sku": "...", "barcode": "..."}.
    """
    try:
        with transaction.atomic():
            instance.save()
    except IntegrityError as exc:
        text = str(exc)
        for marker, message in friendly.items():
            if marker in text:
                raise ServiceError("ALREADY_EXISTS", message) from exc
        raise


def _assert_no_category_cycle(tenant: "Tenant", category_pk: UUID, parent: Category | None) -> None:
    """Reject a parent choice that would put a category in its own subtree."""
    seen: set[UUID] = set()
    current: Category | None = parent
    steps = 0
    while current is not None:
        if current.pk == category_pk:
            raise ServiceError("CATEGORY_CYCLE", "A category cannot be its own ancestor.")
        if current.pk in seen or steps >= _MAX_TREE_WALK:
            # Pre-existing corruption; fail loudly rather than loop forever.
            raise ServiceError(
                "CATEGORY_CYCLE", "Category tree already contains a cycle; contact support."
            )
        seen.add(current.pk)
        steps += 1
        current = (
            Category.objects.filter(tenant=tenant, pk=current.parent_id).first()
            if current.parent_id
            else None
        )


# --- Categories ---------------------------------------------------------------


def create_category(tenant: "Tenant", **fields: Any) -> Category:
    """Create a category, validating the parent belongs to this tenant."""
    parent_id = fields.pop("parent", None)
    parent = _get_for_tenant(Category, tenant, parent_id, "Parent category") if parent_id else None
    size_chart_id = fields.pop("size_chart", None)
    if size_chart_id:
        fields["size_chart"] = _get_for_tenant(SizeChart, tenant, size_chart_id, "Size chart")
    category = Category(tenant=tenant, parent=parent, **fields)
    _save_with_friendly_uniqueness(category, {})
    return category


def update_category(tenant: "Tenant", category: Category, **fields: Any) -> Category:
    """Update a category; re-parenting goes through the cycle guard."""
    if "parent" in fields:
        parent_id = fields.pop("parent")
        parent = (
            _get_for_tenant(Category, tenant, parent_id, "Parent category") if parent_id else None
        )
        _assert_no_category_cycle(tenant, category.pk, parent)
        category.parent = parent
    if fields.get("size_chart"):
        fields["size_chart"] = _get_for_tenant(
            SizeChart, tenant, fields["size_chart"], "Size chart"
        )
    for name, value in fields.items():
        setattr(category, name, value)
    _save_with_friendly_uniqueness(category, {})
    return category


# --- Brands / size charts -----------------------------------------------------


def create_brand(tenant: "Tenant", **fields: Any) -> Brand:
    """Create a brand (name unique per tenant)."""
    brand = Brand(tenant=tenant, **fields)
    _save_with_friendly_uniqueness(
        brand, {"brand_tenant_name_uniq": "A brand with this name already exists."}
    )
    return brand


def update_brand(brand: Brand, **fields: Any) -> Brand:
    for name, value in fields.items():
        setattr(brand, name, value)
    _save_with_friendly_uniqueness(
        brand, {"brand_tenant_name_uniq": "A brand with this name already exists."}
    )
    return brand


def create_size_chart(
    tenant: "Tenant", *, name: str, values: list[str], is_active: bool = True
) -> SizeChart:
    """Create an ordered size chart; at least one non-empty size required."""
    cleaned = [v.strip() for v in values if v.strip()]
    if not cleaned:
        raise ServiceError("SIZE_CHART_EMPTY", "A size chart needs at least one size.")
    chart = SizeChart(tenant=tenant, name=name, values=cleaned, is_active=is_active)
    chart.save()
    return chart


def update_size_chart(chart: SizeChart, **fields: Any) -> SizeChart:
    if "values" in fields:
        cleaned = [v.strip() for v in fields["values"] if v.strip()]
        if not cleaned:
            raise ServiceError("SIZE_CHART_EMPTY", "A size chart needs at least one size.")
        fields["values"] = cleaned
    for name, value in fields.items():
        setattr(chart, name, value)
    chart.save()
    return chart


# --- Items --------------------------------------------------------------------


@transaction.atomic
def create_item(tenant: "Tenant", *, created_by: "User", **fields: Any) -> Item:
    """Create an item (code unique per tenant, min≤max price bounds)."""
    enforce_creation_limit(
        tenant,
        key="max_items",
        queryset=Item.objects.filter(tenant=tenant, is_active=True),
        label="active items",
    )
    validate_price_bounds(fields.get("min_selling_price"), fields.get("max_selling_price"))
    for fk, model, what in (
        ("category", Category, "Category"),
        ("brand", Brand, "Brand"),
        ("size_chart", SizeChart, "Size chart"),
    ):
        if fields.get(fk):
            fields[fk] = _get_for_tenant(model, tenant, fields[fk], what)
    item = Item(tenant=tenant, created_by=created_by, **fields)
    _save_with_friendly_uniqueness(
        item, {"item_tenant_code_uniq": "An item with this code already exists."}
    )
    return item


def update_item(tenant: "Tenant", item: Item, **fields: Any) -> Item:
    new_min = fields.get("min_selling_price", item.min_selling_price)
    new_max = fields.get("max_selling_price", item.max_selling_price)
    validate_price_bounds(new_min, new_max)
    for fk, model, what in (
        ("category", Category, "Category"),
        ("brand", Brand, "Brand"),
        ("size_chart", SizeChart, "Size chart"),
    ):
        if fields.get(fk):
            fields[fk] = _get_for_tenant(model, tenant, fields[fk], what)
    for name, value in fields.items():
        setattr(item, name, value)
    _save_with_friendly_uniqueness(
        item, {"item_tenant_code_uniq": "An item with this code already exists."}
    )
    return item


# --- Variants -----------------------------------------------------------------


def _variant_friendly() -> dict[str, str]:
    return {
        "variant_tenant_sku_uniq": "A variant with this SKU already exists.",
        "variant_tenant_barcode_uniq": "This barcode is already assigned to another variant.",
        "variant_combo_uniq": "This size/colour combination already exists for the item.",
    }


def create_variant(tenant: "Tenant", *, item: Item, **fields: Any) -> ItemVariant:
    """Create one variant; barcode validated per ADR 0003."""
    validate_price_bounds(fields.get("min_selling_price"), fields.get("max_selling_price"))
    if fields.get("barcode"):
        try:
            fields["barcode"] = validate_barcode(fields["barcode"])
        except BarcodeValidationError as exc:
            raise ServiceError("BARCODE_INVALID", str(exc)) from exc
    variant = ItemVariant(tenant=tenant, item=item, **fields)
    _save_with_friendly_uniqueness(variant, _variant_friendly())
    return variant


def update_variant(variant: ItemVariant, **fields: Any) -> ItemVariant:
    new_min = fields.get("min_selling_price", variant.min_selling_price)
    new_max = fields.get("max_selling_price", variant.max_selling_price)
    validate_price_bounds(new_min, new_max)
    if fields.get("barcode"):
        try:
            fields["barcode"] = validate_barcode(fields["barcode"])
        except BarcodeValidationError as exc:
            raise ServiceError("BARCODE_INVALID", str(exc)) from exc
    for name, value in fields.items():
        setattr(variant, name, value)
    _save_with_friendly_uniqueness(variant, _variant_friendly())
    return variant


def bulk_create_variants(
    tenant: "Tenant",
    *,
    item: Item,
    sizes: list[str],
    colors: list[str],
    mrp: Decimal | None = None,
) -> dict[str, Any]:
    """Size × colour matrix entry (design §7.4): the whole grid, one transaction.

    Existing combinations are skipped, not duplicated; the response reports
    both so the entry screen can show exactly what happened.
    """
    if not sizes or not colors:
        raise ServiceError("MATRIX_EMPTY", "Provide at least one size and one colour.")

    existing = set(
        ItemVariant.objects.filter(tenant=tenant, item=item).values_list("size", "color")
    )
    created: list[ItemVariant] = []
    skipped: list[dict[str, str]] = []

    with transaction.atomic():
        for size in sizes:
            for color in colors:
                if (size, color) in existing:
                    skipped.append({"size": size, "color": color, "reason": "already exists"})
                    continue
                variant = ItemVariant(
                    tenant=tenant,
                    item=item,
                    size=size,
                    color=color,
                    sku=_generate_sku(item, size, color),
                    mrp=mrp,
                )
                variant.save()
                created.append(variant)
                existing.add((size, color))

    return {
        "created_count": len(created),
        "skipped_count": len(skipped),
        "created": created,
        "skipped": skipped,
    }


def _generate_sku(item: Item, size: str, color: str) -> str:
    """Deterministic SKU: item code + size + colour (unique per tenant via item code)."""

    def clean(part: str) -> str:
        return "".join(ch for ch in part.upper().replace(" ", "-") if ch.isalnum() or ch == "-")

    return f"{clean(item.code)}-{clean(size)}-{clean(color)}"


def deactivate(instance: Any) -> Any:
    """Master data is deactivated, never hard-deleted (stock/sales history)."""
    instance.is_active = False
    instance.save(update_fields=["is_active", "updated_at"])
    return instance


# --- Item images ---------------------------------------------------------------

IMAGE_MAX_BYTES = 2 * 1024 * 1024  # 2 MB — counter photos, not print assets

#: Detected PIL format → canonical file extension. The sniffed format, not
#: the client filename, decides the extension written to storage.
_IMAGE_FORMAT_EXTENSIONS = {"JPEG": ".jpg", "PNG": ".png", "WEBP": ".webp"}


def _sniff_image_extension(uploaded: IO[bytes]) -> str:
    """Return the canonical extension for the upload's real image format.

    Sniffs magic bytes with Pillow; a text file renamed ``.png`` fails here.
    Raises IMAGE_TYPE_UNSUPPORTED for anything that is not jpeg/png/webp.
    """
    from PIL import Image, UnidentifiedImageError

    try:
        with Image.open(uploaded) as probe:
            detected = probe.format
    except (UnidentifiedImageError, OSError):
        detected = None
    finally:
        uploaded.seek(0)
    extension = _IMAGE_FORMAT_EXTENSIONS.get(str(detected or ""))
    if extension is None:
        raise ServiceError(
            "IMAGE_TYPE_UNSUPPORTED",
            "Only JPEG, PNG, or WebP images are accepted.",
        )
    return extension


def set_item_image(item: Item, uploaded: Any) -> Item:
    """Attach an image to an item, replacing any previous file.

    ``uploaded`` is a Django ``UploadedFile``. Validation: 2 MB cap, then
    Pillow content sniffing (jpeg/png/webp). The stored filename is
    server-generated by ``item_image_upload_to`` with the extension derived
    from the detected format. The previous file is deleted from storage only
    after the new save succeeds.
    """
    size = getattr(uploaded, "size", None)
    if size is not None and size > IMAGE_MAX_BYTES:
        raise ServiceError("IMAGE_TOO_LARGE", "Images must be 2 MB or smaller.")
    extension = _sniff_image_extension(uploaded)
    old_name = item.image.name if item.image else None
    with transaction.atomic():
        item.image.save(f"image{extension}", uploaded, save=True)
    if old_name and old_name != item.image.name:
        item.image.storage.delete(old_name)
    return item


def clear_item_image(item: Item) -> Item:
    """Remove the item's image: delete the stored file and null the column."""
    if item.image:
        item.image.delete(save=True)  # deletes the file, nulls the field, saves
    return item
