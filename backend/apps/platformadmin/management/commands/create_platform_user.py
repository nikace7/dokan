"""Provision a platform user without exposing a password in shell history."""

from getpass import getpass
from urllib.parse import quote

from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError, CommandParser
from django.core.validators import validate_email

from apps.platformadmin.models import PlatformUser
from apps.platformadmin.totp import generate_totp_secret


class Command(BaseCommand):
    help = "Create a platform user and print the one-time TOTP enrollment secret."

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument("--email", required=True)
        parser.add_argument("--full-name", required=True)
        parser.add_argument(
            "--role",
            choices=[choice for choice, _ in PlatformUser.Role.choices],
            default=PlatformUser.Role.SUPER_ADMIN,
        )

    def handle(self, *args: object, **options: object) -> None:
        email = str(options["email"]).strip().lower()
        full_name = str(options["full_name"]).strip()
        try:
            validate_email(email)
        except ValidationError as exc:
            raise CommandError("Enter a valid email address.") from exc
        if not full_name:
            raise CommandError("Full name is required.")
        if PlatformUser.objects.filter(email__iexact=email).exists():
            raise CommandError("A platform user with this email already exists.")
        password = getpass("Password (12+ characters): ")
        confirmation = getpass("Confirm password: ")
        if password != confirmation:
            raise CommandError("Passwords do not match.")
        if len(password) < 12:
            raise CommandError("Password must contain at least 12 characters.")

        secret = generate_totp_secret()
        user = PlatformUser(
            email=email,
            full_name=full_name,
            role=str(options["role"]),
            totp_secret=secret,
        )
        user.set_password(password)
        user.save()

        label = quote(f"mero-pasal.online:{email}")
        issuer = quote("mero-pasal.online")
        self.stdout.write(self.style.SUCCESS(f"Created platform user {email}."))
        self.stdout.write(f"TOTP secret (show once): {secret}")
        self.stdout.write(
            f"Authenticator URI: otpauth://totp/{label}?secret={secret}&issuer={issuer}"
        )
