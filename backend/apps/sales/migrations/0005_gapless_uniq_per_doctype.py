# Generated for feat(returns): include doc_type in the gapless uniqueness.

from django.db import migrations, models
from django.db.models import Q


class Migration(migrations.Migration):
    """SALE and RETURN have their own gapless numbering series (the
    number_sequence key includes doc_type), so invoice_no uniqueness must
    too — otherwise RETURN #1 collides with SALE #1 on the same branch
    and fiscal year. docs/DATABASE_SCHEMA.md's constraint predates
    doc_type-separated series.
    """

    dependencies = [
        ("sales", "0004_salesinvoice_refunds"),
    ]

    operations = [
        migrations.RemoveConstraint(
            model_name="salesinvoice",
            name="invoice_gapless_number_uniq",
        ),
        migrations.AddConstraint(
            model_name="salesinvoice",
            constraint=models.UniqueConstraint(
                fields=["tenant", "branch", "fiscal_year_bs", "doc_type", "invoice_no"],
                condition=Q(invoice_no__isnull=False),
                name="invoice_gapless_number_uniq",
            ),
        ),
    ]
