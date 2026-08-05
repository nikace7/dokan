import uuid

import django.db.models.deletion
from django.db import migrations, models

from core.db.rls import revoke_update_delete_operation


class Migration(migrations.Migration):
    dependencies = [
        ("platformadmin", "0001_initial"),
        ("tenants", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="PlatformAuditLog",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ("action", models.TextField()),
                ("payload", models.JSONField(default=dict)),
                ("ip", models.GenericIPAddressField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "actor",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="audit_entries",
                        to="platformadmin.platformuser",
                    ),
                ),
                (
                    "tenant",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="platform_audit_entries",
                        to="tenants.tenant",
                    ),
                ),
            ],
            options={
                "db_table": "platform_audit_log",
                "ordering": ["-created_at"],
                "indexes": [
                    models.Index(
                        fields=["tenant", "-created_at"],
                        name="platform_audit_tenant_idx",
                    ),
                    models.Index(
                        fields=["actor", "-created_at"],
                        name="platform_audit_actor_idx",
                    ),
                    models.Index(
                        fields=["action", "-created_at"],
                        name="platform_audit_action_idx",
                    ),
                ],
            },
        ),
        revoke_update_delete_operation("platform_audit_log"),
    ]
