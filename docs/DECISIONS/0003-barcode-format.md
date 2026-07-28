# 0003. Barcode format — Code 128 in-house, EAN-13 accepted

**Status:** Accepted
**Date:** 2026-07-27

## Context

Shops receive unlabelled goods and must generate and print barcode labels
in-app (§1.2, §7.4); some goods arrive pre-labelled by suppliers. The barcode
lookup (`GET /items/lookup?barcode=`) is the POS hot path at a 200 rps load
target, backed by the partial unique index
`(tenant_id, barcode) WHERE barcode IS NOT NULL`. The design mandates in-app
barcode generation but does not pick a symbology.

Requirements:

- Encode alphanumeric content (SKUs embed letters) at variable length.
- Print reliably on cheap thermal label printers; scan reliably with budget
  handheld scanners and phone cameras.
- Accept supplier-pre-labelled goods without relabelling.

## Decision

- **In-house generated variant barcodes: Code 128.** Full ASCII, variable
  length, compact (high density), universally supported by thermal printers and
  scanners. Generated barcodes use the variant SKU as the payload with a
  fixed prefix so they are self-identifying.
- **Supplier-pre-labelled goods: EAN-13 accepted as-is.** Staff scan the
  existing label at stock entry; the value is stored on
  `item_variant.barcode` unchanged. No relabelling, no conversion.
- **Uniqueness:** `UNIQUE (tenant_id, barcode)` — global within a tenant,
  enforced by the partial unique index. A barcode collision at entry is a
  validation error with both variants shown.
- **Validation at write time:** Code 128 payloads are validated for allowed
  character range; EAN-13 inputs are checksum-validated so a mis-typed manual
  entry is caught instead of poisoning the hot path.

## Alternatives

- **EAN-13 for everything** — rejected; numeric-only, fixed 13 digits, wastes
  label space on padding, and cannot encode the SKU naturally.
- **QR codes** — rejected for shelf/garment labels; slower to scan with
  handheld laser scanners, larger minimum print size, no benefit when the
  payload is a single identifier. (QR is still used for *payments* — Fonepay —
  which is unrelated.)
- **UPC-A / Code 39** — rejected; UPC-A is numeric-only, Code 39 is
  low-density (long labels on small garment tags).

## Consequences

- One lookup path for all barcodes: exact match on the partial unique index,
  regardless of symbology. The scanner sends the decoded string; the system
  does not care which symbology produced it.
- Label printing must render Code 128 with adequate quiet zones; the
  barcode/price-tag printing feature (Phase 2) owns this.
- The self-identifying prefix for generated codes prevents accidental
  collision between a generated Code 128 and a supplier EAN-13.
- Check-in of GS1-standard EANs keeps the door open to future integrations
  (supplier catalogs, e-commerce sync) that assume EAN-13.
