"""Constants for the tenants app."""

from typing import Final

#: Slugs that never name a tenant (docs/SYSTEM_DESIGN.md §2.3). The tenant
#: middleware imports this same list to route platform hosts.
RESERVED_SLUGS: Final = frozenset(
    {"www", "app", "api", "admin", "mail", "static", "cdn", "blog", "help", "status", "staging"}
)


class TenantStatus:
    """Tenant lifecycle states (text + CHECK, docs/DATABASE_SCHEMA.md §2.2)."""

    TRIAL = "TRIAL"
    ACTIVE = "ACTIVE"
    PAST_DUE = "PAST_DUE"
    SUSPENDED = "SUSPENDED"
    CANCELLED = "CANCELLED"

    CHOICES: Final = (
        (TRIAL, "Trial"),
        (ACTIVE, "Active"),
        (PAST_DUE, "Past due"),
        (SUSPENDED, "Suspended"),
        (CANCELLED, "Cancelled"),
    )

    #: Statuses allowed to use the app; everything else is rejected.
    ACTIVE_STATUSES: Final = frozenset({TRIAL, ACTIVE})


SLUG_MIN_LENGTH: Final = 3
SLUG_MAX_LENGTH: Final = 30
