from typing import TYPE_CHECKING

import django.db.models.deletion
from django.db import migrations, models
from django.db.models import Q

if TYPE_CHECKING:
    from django.apps.registry import Apps
    from django.db.backends.base.schema import BaseDatabaseSchemaEditor


def seed_payment_reversal_permission(
    apps: "Apps", schema_editor: "BaseDatabaseSchemaEditor"
) -> None:
    permission_model = apps.get_model("accounts", "Permission")
    permission_model.objects.update_or_create(
        code="payment.reverse",
        defaults={
            "module": "Payments",
            "name": "Reverse payments",
            "is_sensitive": True,
        },
    )


def unseed_payment_reversal_permission(
    apps: "Apps", schema_editor: "BaseDatabaseSchemaEditor"
) -> None:
    apps.get_model("accounts", "Permission").objects.filter(code="payment.reverse").delete()


class Migration(migrations.Migration):
    dependencies = [("payments", "0002_cashsession")]

    operations = [
        migrations.AddField(
            model_name="payment",
            name="reversal_of",
            field=models.OneToOneField(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="reversal",
                to="payments.payment",
            ),
        ),
        migrations.AddConstraint(
            model_name="payment",
            constraint=models.CheckConstraint(
                condition=(
                    Q(reversal_of__isnull=True, amount__gt=0)
                    | Q(reversal_of__isnull=False, amount__lt=0)
                ),
                name="payment_amount_reversal_check",
            ),
        ),
        migrations.RunPython(
            seed_payment_reversal_permission,
            unseed_payment_reversal_permission,
        ),
    ]
