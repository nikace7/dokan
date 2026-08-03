from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("sales", "0005_gapless_uniq_per_doctype")]

    operations = [
        migrations.AddField(
            model_name="salesinvoice",
            name="tenders",
            field=models.JSONField(default=list),
        ),
    ]
