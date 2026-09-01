"""Tests for the project-wide DRF error envelope."""

import pytest
from rest_framework.exceptions import AuthenticationFailed, NotAuthenticated, ValidationError

from core.exceptions import _code_for


@pytest.mark.parametrize(
    ("exception", "expected"),
    [
        (AuthenticationFailed("Invalid token."), "AUTHENTICATION_FAILED"),
        (AuthenticationFailed("No account.", code="no_active_account"), "NO_ACTIVE_ACCOUNT"),
        (NotAuthenticated("Sign in."), "NOT_AUTHENTICATED"),
        (ValidationError({"phone": ["Required."]}), "VALIDATION_ERROR"),
    ],
)
def test_exception_codes_are_stable_upper_snake_case(exception: Exception, expected: str) -> None:
    assert _code_for(exception) == expected
