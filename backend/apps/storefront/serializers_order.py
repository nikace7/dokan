"""Serializers for the ordering flow — checkout input and public order output.

As with the catalog payloads, these are hand-written: the order output must
only ever carry the customer-facing snapshot fields, and the checkout input
is shape-only validation (business rules live in ``services_orders``).
"""

from decimal import Decimal

from rest_framework import serializers

from apps.storefront.models import StoreOrder


class CheckoutCustomerSerializer(serializers.Serializer):
    email = serializers.EmailField()
    full_name = serializers.CharField(max_length=120)
    phone = serializers.CharField(max_length=32, required=False, allow_blank=True, default="")


class CheckoutAddressSerializer(serializers.Serializer):
    line1 = serializers.CharField(max_length=200)
    city = serializers.CharField(max_length=120)
    area = serializers.CharField(max_length=120, required=False, allow_blank=True, default="")
    landmark = serializers.CharField(max_length=200, required=False, allow_blank=True, default="")
    lat = serializers.FloatField(required=False, allow_null=True, default=None)
    lng = serializers.FloatField(required=False, allow_null=True, default=None)
    note = serializers.CharField(max_length=300, required=False, allow_blank=True, default="")


class CheckoutLineSerializer(serializers.Serializer):
    variant = serializers.UUIDField()
    qty = serializers.DecimalField(max_digits=12, decimal_places=3, min_value=Decimal("0.001"))


class CheckoutSerializer(serializers.Serializer):
    customer = CheckoutCustomerSerializer()
    fulfillment = serializers.ChoiceField(choices=StoreOrder.Fulfillment.choices)
    payment_method = serializers.ChoiceField(choices=StoreOrder.PaymentMethod.choices)
    address = CheckoutAddressSerializer(required=False, allow_null=True, default=None)
    note = serializers.CharField(max_length=500, required=False, allow_blank=True, default="")
    items = CheckoutLineSerializer(many=True, allow_empty=False)

    def validate(self, attrs: dict) -> dict:
        if attrs["fulfillment"] == StoreOrder.Fulfillment.DELIVERY and not attrs.get("address"):
            raise serializers.ValidationError({"address": "Delivery orders need an address."})
        variant_ids = [line["variant"] for line in attrs["items"]]
        if len(variant_ids) != len(set(variant_ids)):
            raise serializers.ValidationError(
                {"items": "Each product option may appear only once in the cart."}
            )
        return attrs


class OtpRequestSerializer(serializers.Serializer):
    email = serializers.EmailField()


class OtpVerifySerializer(serializers.Serializer):
    email = serializers.EmailField()
    code = serializers.CharField(min_length=6, max_length=6)


class PublicOrderItemSerializer(serializers.Serializer):
    name = serializers.CharField()
    size = serializers.CharField()
    color = serializers.CharField()
    unit_price = serializers.DecimalField(max_digits=14, decimal_places=2)
    compare_at = serializers.DecimalField(max_digits=14, decimal_places=2, allow_null=True)
    qty = serializers.DecimalField(max_digits=12, decimal_places=3)
    line_total = serializers.DecimalField(max_digits=14, decimal_places=2)


class PublicOrderSerializer(serializers.Serializer):
    """Customer-facing order view (tracking link and order history)."""

    number_text = serializers.CharField()
    status = serializers.CharField()
    fulfillment = serializers.CharField()
    payment_method = serializers.CharField()
    payment_status = serializers.CharField()
    address = serializers.JSONField(allow_null=True)
    note = serializers.CharField()
    currency = serializers.CharField()
    subtotal = serializers.DecimalField(max_digits=14, decimal_places=2)
    total = serializers.DecimalField(max_digits=14, decimal_places=2)
    offer_text = serializers.CharField()
    tracking_token = serializers.UUIDField()
    business_date_ad = serializers.DateField()
    business_date_bs = serializers.CharField()
    created_at = serializers.DateTimeField()
    items = PublicOrderItemSerializer(many=True)


def order_payload(order: StoreOrder) -> dict:
    """Serialize an order with its items prefetched by the caller."""
    return PublicOrderSerializer(order).data


def management_order_payload(order: StoreOrder) -> dict:
    """Tenant-staff order view; contains no stock cost or credential fields."""
    payload = order_payload(order)
    invoice = order.sales_invoice if order.sales_invoice_id else None
    return {
        "id": str(order.pk),
        **payload,
        "customer": {
            "email": order.customer.email,
            "full_name": order.customer.full_name,
            "phone": order.customer.phone,
        },
        "branch": {"id": str(order.branch_id), "name": order.branch.name},
        "sales_invoice": (
            {
                "id": str(invoice.pk),
                "status": invoice.status,
                "invoice_no": invoice.invoice_no,
            }
            if invoice is not None
            else None
        ),
    }
