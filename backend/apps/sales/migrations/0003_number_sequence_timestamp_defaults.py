# Generated for feat(sales): number_sequence timestamp DB defaults.

from django.db import migrations


class Migration(migrations.Migration):
    """core/numbering.py's raw INSERT/UPDATE omits created_at/updated_at.

    The columns come from TenantScopedModel and are NOT NULL, so the raw
    allocation SQL needs DB-level defaults. updated_at is not maintained on
    raw UPDATEs of next_number — acceptable for this internal ops table
    (the sequence value is the only mutable state that matters).
    """

    dependencies = [
        ("sales", "0002_sale_view_permission"),
    ]

    operations = [
        migrations.RunSQL(
            sql=(
                "ALTER TABLE number_sequence ALTER COLUMN created_at SET DEFAULT now();\n"
                "ALTER TABLE number_sequence ALTER COLUMN updated_at SET DEFAULT now();"
            ),
            reverse_sql=(
                "ALTER TABLE number_sequence ALTER COLUMN created_at DROP DEFAULT;\n"
                "ALTER TABLE number_sequence ALTER COLUMN updated_at DROP DEFAULT;"
            ),
        ),
    ]
