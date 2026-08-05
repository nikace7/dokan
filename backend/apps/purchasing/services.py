"""Write-side business logic for purchasing — suppliers and purchase invoices.

Confirm pipeline (one transaction): PURCHASE movement per line at LANDED
unit cost (line net + allocated other_charges, exact-paisa largest
remainder), StockBatch row per line, gapless PURCHASE-series number.
DRAFT is editable; CONFIRMED is terminal; CANCELLED only from DRAFT.
"""

from datetime import date
from decimal import Decimal
from typing import TYPE_CHECKING, Any

from django.db import connection, transaction
from django.utils import timezone

from apps.inventory.models import StockBatch
from apps.inventory.services import post_purchase_movement
from apps.purchasing.models import PurchaseInvoice, PurchaseInvoiceItem, Supplier
from apps.tenants.services import require_plan_feature
from core.calendar.bs import ad_to_bs, fiscal_year_bs
from core.money import quantize_money
from core.numbering import allocate_number
from core.responses import ServiceError

if TYPE_CHECKING:
    from apps.accounts.models import User
    from apps.tenants.models import Tenant

#: Nepal VAT rate — mirrors the sales rule (apps/sales/services/create_sale.py).
VAT_RATE = Decimal("0.13")

_ZERO = Decimal("0")


# --- Suppliers ----------------------------------------------------------------


def create_supplier(tenant: "Tenant", **fields: Any) -> Supplier:
    """Create a supplier (name is not unique — real vendors repeat)."""
    supplier = Supplier(tenant=tenant, **fields)
    supplier.save()
    return supplier


def update_supplier(supplier: Supplier, **fields: Any) -> Supplier:
    for name, value in fields.items():
        setattr(supplier, name, value)
    supplier.save()
    return supplier


def deactivate_supplier(supplier: Supplier) -> Supplier:
    """Master data is deactivated, never hard-deleted (invoice history)."""
    supplier.is_active = False
    supplier.save(update_fields=["is_active", "updated_at"])
    return supplier


# --- Landed cost allocation ----------------------------------------------------


def allocate_landed_cost(line_nets: list[Decimal], charges: Decimal) -> list[Decimal]:
    """Distribute other_charges across lines proportional to net line total.

    Exact-paisa via largest remainder: the allocated amounts always sum to
    exactly ``charges`` — no rounding drift into the stock valuation.
    """
    if charges <= _ZERO or not line_nets:
        return [_ZERO for _ in line_nets]
    total_net = sum(line_nets)
    if total_net <= _ZERO:
        return [_ZERO for _ in line_nets]
    total_paisa = int((charges * 100).to_integral_value())
    exact = [charges * 100 * net / total_net for net in line_nets]
    base = [int(value) for value in exact]  # floor to paisa
    remainder = total_paisa - sum(base)
    by_fraction = sorted(range(len(exact)), key=lambda i: exact[i] - base[i], reverse=True)
    for i in by_fraction[:remainder]:
        base[i] += 1
    return [Decimal(paisa) / 100 for paisa in base]


# --- Purchase invoices ----------------------------------------------------------


def _line_net(item: PurchaseInvoiceItem) -> Decimal:
    return quantize_money(item.qty * item.unit_cost - item.discount)


def _compute_invoice_totals(
    tenant: "Tenant", invoice: PurchaseInvoice, items: list[PurchaseInvoiceItem]
) -> dict[str, Decimal]:
    """Totals mirroring the sales VAT rule: 13% on the VAT-applicable lines'
    taxable amount when the bill is a VAT bill and the tenant is registered."""
    if invoice.is_vat_bill:
        require_plan_feature(tenant, "vat_module")
    subtotal = quantize_money(sum(item.qty * item.unit_cost for item in items))
    discount = quantize_money(sum(item.discount for item in items))
    taxable = quantize_money(subtotal - discount)
    vat = _ZERO
    if invoice.is_vat_bill and tenant.vat_registered:
        vat_base = sum(_line_net(item) for item in items if item.variant.item.is_vat_applicable)
        vat = quantize_money(vat_base * VAT_RATE)
    total = quantize_money(taxable + vat + invoice.other_charges)
    return {
        "subtotal": subtotal,
        "discount": discount,
        "taxable_amount": taxable,
        "vat_amount": vat,
        "total": total,
    }


def _validate_lines(lines: list[dict[str, Any]]) -> None:
    if not lines:
        raise ServiceError("LINES_REQUIRED", "A purchase bill needs at least one line.")
    for line in lines:
        if Decimal(line["qty"]) <= _ZERO:
            raise ServiceError("QTY_INVALID", "Line quantity must be greater than zero.")
        if Decimal(line["unit_cost"]) < _ZERO:
            raise ServiceError("COST_INVALID", "Unit cost cannot be negative.")


def create_purchase_invoice(
    tenant: "Tenant",
    *,
    branch: Any,
    supplier: Supplier,
    bill_date_ad: date,
    is_vat_bill: bool,
    other_charges: Decimal,
    paid_amount: Decimal,
    note: str,
    lines: list[dict[str, Any]],
    created_by: "User",
) -> PurchaseInvoice:
    """Create a DRAFT purchase invoice with its lines."""
    _validate_lines(lines)
    invoice = PurchaseInvoice(
        tenant=tenant,
        branch=branch,
        supplier=supplier,
        bill_date_ad=bill_date_ad,
        bill_date_bs=ad_to_bs(bill_date_ad),
        fiscal_year_bs=fiscal_year_bs(bill_date_ad),
        is_vat_bill=is_vat_bill,
        other_charges=quantize_money(other_charges),
        paid_amount=quantize_money(paid_amount),
        note=note or None,
        created_by=created_by,
    )
    invoice.save()
    _replace_items(tenant, invoice, lines)
    _recompute_and_store(tenant, invoice)
    return invoice


def _replace_items(tenant: "Tenant", invoice: PurchaseInvoice, lines: list[dict[str, Any]]) -> None:
    """Replace all DRAFT line rows (draft working state, like held bills)."""
    invoice.items.all().delete()
    PurchaseInvoiceItem.objects.bulk_create(
        [
            PurchaseInvoiceItem(
                tenant=tenant,
                invoice=invoice,
                variant=line["variant"],
                qty=line["qty"],
                unit_cost=quantize_money(line["unit_cost"]),
                discount=quantize_money(line.get("discount", _ZERO)),
                line_total=quantize_money(
                    Decimal(line["qty"]) * Decimal(line["unit_cost"])
                    - Decimal(line.get("discount", _ZERO))
                ),
            )
            for line in lines
        ]
    )


def _recompute_and_store(tenant: "Tenant", invoice: PurchaseInvoice) -> None:
    items = list(invoice.items.select_related("variant", "variant__item"))
    totals = _compute_invoice_totals(tenant, invoice, items)
    invoice.subtotal = totals["subtotal"]
    invoice.discount = totals["discount"]
    invoice.taxable_amount = totals["taxable_amount"]
    invoice.vat_amount = totals["vat_amount"]
    invoice.total = totals["total"]
    invoice.due_amount = quantize_money(max(invoice.total - invoice.paid_amount, _ZERO))
    invoice.save()


def update_purchase_invoice(
    tenant: "Tenant",
    *,
    invoice: PurchaseInvoice,
    fields: dict[str, Any],
    lines: list[dict[str, Any]] | None = None,
) -> PurchaseInvoice:
    """Edit a DRAFT invoice (header fields and/or full line replacement)."""
    if invoice.status != PurchaseInvoice.Status.DRAFT:
        raise ServiceError(
            "INVOICE_NOT_EDITABLE",
            "Only draft purchase bills can be changed.",
            http_status=409,
        )
    if "bill_date_ad" in fields:
        invoice.bill_date_ad = fields["bill_date_ad"]
        invoice.bill_date_bs = ad_to_bs(invoice.bill_date_ad)
        invoice.fiscal_year_bs = fiscal_year_bs(invoice.bill_date_ad)
    for name in ("is_vat_bill", "other_charges", "paid_amount", "note", "supplier"):
        if name in fields:
            setattr(invoice, name, fields[name])
    if lines is not None:
        _validate_lines(lines)
        _replace_items(tenant, invoice, lines)
    _recompute_and_store(tenant, invoice)
    return invoice


def confirm_purchase_invoice(
    tenant: "Tenant", *, invoice: PurchaseInvoice, created_by: "User"
) -> PurchaseInvoice:
    """Confirm a DRAFT: stock in via PURCHASE movements + batches, one transaction.

    Landed unit cost per line = (net line total + allocated other_charges)
    / qty, allocated exact-paisa by largest remainder. The PURCHASE
    movement carries the landed cost so avg_cost reflects true cost.
    """
    if invoice.status != PurchaseInvoice.Status.DRAFT:
        raise ServiceError(
            "INVOICE_NOT_EDITABLE",
            "Only draft purchase bills can be confirmed.",
            http_status=409,
        )
    items = list(invoice.items.select_related("variant", "variant__item"))
    if not items:
        raise ServiceError("LINES_REQUIRED", "A purchase bill needs at least one line.")

    allocations = allocate_landed_cost([_line_net(item) for item in items], invoice.other_charges)
    with transaction.atomic():
        _recompute_and_store(tenant, invoice)
        invoice.invoice_no = allocate_number(
            connection,
            tenant_id=tenant.pk,
            branch_id=invoice.branch_id,
            doc_type="PURCHASE",
            fiscal_year_bs=invoice.fiscal_year_bs,
            prefix=invoice.branch.invoice_prefix,
        )
        invoice.status = PurchaseInvoice.Status.CONFIRMED
        invoice.save()

        for item, allocated in zip(items, allocations, strict=True):
            landed_unit = quantize_money((_line_net(item) + allocated) / item.qty)
            post_purchase_movement(
                tenant,
                branch=invoice.branch,
                variant=item.variant,
                qty=item.qty,
                unit_cost=landed_unit,
                created_by=created_by,
                ref_type="purchase_invoice",
                ref_id=invoice.pk,
                note=f"Purchase {invoice.invoice_no} from {invoice.supplier.name}",
                business_date=invoice.bill_date_ad,
            )
            StockBatch.objects.create(
                tenant=tenant,
                branch=invoice.branch,
                variant=item.variant,
                purchase_item=item,
                qty_in=item.qty,
                qty_remaining=item.qty,
                unit_cost=item.unit_cost,
                landed_cost=landed_unit,
                received_at=timezone.now(),
            )
    return invoice


def cancel_purchase_invoice(tenant: "Tenant", *, invoice: PurchaseInvoice) -> PurchaseInvoice:
    """Void a DRAFT — a status change, never a DELETE."""
    if invoice.status != PurchaseInvoice.Status.DRAFT:
        raise ServiceError(
            "INVOICE_NOT_EDITABLE",
            "Only draft purchase bills can be cancelled.",
            http_status=409,
        )
    invoice.status = PurchaseInvoice.Status.CANCELLED
    invoice.save(update_fields=["status", "updated_at"])
    return invoice
