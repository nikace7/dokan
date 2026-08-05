"""DRF serializers for accounts — shape validation only; rules live in services."""

from typing import Any

from rest_framework import serializers

from apps.accounts.models import Permission, Role, User


class PermissionSerializer(serializers.ModelSerializer):
    """Global permission metadata for the role editor."""

    class Meta:
        model = Permission
        fields = ("code", "module", "name", "description", "is_sensitive")
        read_only_fields = fields


class RoleSerializer(serializers.ModelSerializer):
    """Role metadata and granted permission codes for owner administration."""

    permission_codes = serializers.SerializerMethodField()

    class Meta:
        model = Role
        fields = ("id", "code", "name", "name_np", "is_system", "description", "permission_codes")
        read_only_fields = fields

    def get_permission_codes(self, obj: Role) -> list[str]:
        return sorted(
            role_permission.permission_id for role_permission in obj.role_permissions.all()
        )


class RoleCreateSerializer(serializers.Serializer):
    """POST /roles payload; permission validity belongs to the service."""

    code = serializers.CharField(max_length=64, trim_whitespace=True)
    name = serializers.CharField(max_length=200, trim_whitespace=True)
    name_np = serializers.CharField(
        max_length=200, required=False, allow_blank=True, allow_null=True
    )
    description = serializers.CharField(
        max_length=500, required=False, allow_blank=True, allow_null=True
    )
    permission_codes = serializers.ListField(
        child=serializers.CharField(max_length=64, trim_whitespace=True),
        required=False,
        allow_empty=True,
    )


class RoleUpdateSerializer(serializers.Serializer):
    """PATCH /roles/<id> payload for custom roles."""

    name = serializers.CharField(max_length=200, required=False, trim_whitespace=True)
    name_np = serializers.CharField(
        max_length=200, required=False, allow_blank=True, allow_null=True
    )
    description = serializers.CharField(
        max_length=500, required=False, allow_blank=True, allow_null=True
    )
    permission_codes = serializers.ListField(
        child=serializers.CharField(max_length=64, trim_whitespace=True),
        required=False,
        allow_empty=True,
    )


class StaffUserSerializer(serializers.ModelSerializer):
    """Staff fields safe for the owner-facing administration screen."""

    roles = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = (
            "id",
            "phone",
            "email",
            "full_name",
            "is_active",
            "must_change_password",
            "roles",
        )
        read_only_fields = fields

    def get_roles(self, obj: User) -> list[dict[str, Any]]:
        return [
            {
                "id": str(assignment.role_id),
                "code": assignment.role.code,
                "name": assignment.role.name,
                "branch_id": str(assignment.branch_id) if assignment.branch_id else None,
                "branch_code": assignment.branch.code if assignment.branch else None,
            }
            for assignment in obj.user_roles.all()
        ]


class StaffCreateSerializer(serializers.Serializer):
    """POST /users payload; new staff must receive an existing role."""

    phone = serializers.CharField(max_length=32, trim_whitespace=True)
    full_name = serializers.CharField(max_length=200, trim_whitespace=True)
    email = serializers.EmailField(required=False, allow_blank=True, allow_null=True)
    password = serializers.CharField(min_length=8, max_length=128, write_only=True)
    role = serializers.UUIDField()
    branch = serializers.UUIDField(required=False, allow_null=True)


class StaffRoleAssignmentSerializer(serializers.Serializer):
    """POST /users/<id>/roles payload."""

    role = serializers.UUIDField()
    branch = serializers.UUIDField(required=False, allow_null=True)


class TokenObtainSerializer(serializers.Serializer):
    """Login payload: phone + password, scoped to the request's tenant."""

    phone = serializers.CharField(max_length=32, trim_whitespace=True)
    password = serializers.CharField(max_length=128, write_only=True, trim_whitespace=False)


class MeSerializer(serializers.Serializer):
    """Current user + resolved permissions for GET /auth/me."""

    id = serializers.UUIDField()
    phone = serializers.CharField()
    full_name = serializers.CharField()
    email = serializers.CharField(allow_null=True)
    must_change_password = serializers.BooleanField()
    permissions = serializers.ListField(child=serializers.CharField())
    plan = serializers.JSONField()

    @classmethod
    def for_user(
        cls,
        user: Any,
        permissions: frozenset[str],
        plan: dict[str, Any],
    ) -> dict[str, Any]:
        """Build the payload for a user (keeps the view thin)."""
        return cls(
            {
                "id": user.pk,
                "phone": user.phone,
                "full_name": user.full_name,
                "email": user.email,
                "must_change_password": user.must_change_password,
                "permissions": sorted(permissions),
                "plan": plan,
            }
        ).data
