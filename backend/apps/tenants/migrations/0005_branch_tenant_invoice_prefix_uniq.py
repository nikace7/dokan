"""One invoice prefix per branch within a shop.

Bills are numbered per branch, so two branches sharing a prefix print the
same number on different bills. If a shop already has such branches, this
fails on purpose: give one of them its own prefix first, knowing its old
bills will show the new prefix.
"""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("tenants", "0004_tenant_shopfront_template"),
    ]

    operations = [
        migrations.AddConstraint(
            model_name="branch",
            constraint=models.UniqueConstraint(
                fields=("tenant", "invoice_prefix"), name="branch_tenant_invoice_prefix_uniq"
            ),
        ),
    ]
