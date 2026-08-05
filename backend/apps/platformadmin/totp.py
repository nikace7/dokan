"""Small RFC 6238 TOTP implementation using only the Python standard library."""

import base64
import binascii
import hashlib
import hmac
import secrets
import struct
import time
from typing import Final

_PERIOD_SECONDS: Final = 30
_DIGITS: Final = 6


def generate_totp_secret() -> str:
    """Generate a 160-bit base32 authenticator secret without padding."""
    return base64.b32encode(secrets.token_bytes(20)).decode("ascii").rstrip("=")


def totp_code(secret: str, *, at: float | int | None = None) -> str:
    """Return the six-digit SHA-1 TOTP code for ``secret`` at ``at``."""
    normalized = "".join(secret.split()).upper()
    padding = "=" * (-len(normalized) % 8)
    try:
        key = base64.b32decode(normalized + padding, casefold=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("Invalid base32 TOTP secret.") from exc
    counter = int(time.time() if at is None else at) // _PERIOD_SECONDS
    digest = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    value = struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF
    return str(value % (10**_DIGITS)).zfill(_DIGITS)


def verify_totp(secret: str, code: str, *, at: float | int | None = None) -> bool:
    """Verify a six-digit code with one 30-second step of clock tolerance."""
    if len(code) != _DIGITS or not code.isascii() or not code.isdigit():
        return False
    timestamp = time.time() if at is None else at
    try:
        return any(
            hmac.compare_digest(
                totp_code(secret, at=timestamp + offset * _PERIOD_SECONDS),
                code,
            )
            for offset in (-1, 0, 1)
        )
    except ValueError:
        return False
