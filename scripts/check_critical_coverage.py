"""Require complete line and branch coverage for money-critical modules."""

from __future__ import annotations

import argparse
import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any

CRITICAL_PREFIXES = (
    "apps/pricing/",
    "apps/sales/services/",
    "core/calendar/",
)
CRITICAL_INVENTORY_FILES = {
    "apps/inventory/counts.py",
    "apps/inventory/receiving.py",
    "apps/inventory/reconciliation.py",
    "apps/inventory/services.py",
    "apps/inventory/transfers.py",
}


def normalize_path(value: str) -> str:
    """Normalize coverage paths produced on Windows and Linux CI runners."""
    normalized = value.replace("\\", "/")
    if normalized.startswith("backend/"):
        return normalized.removeprefix("backend/")
    return normalized


def is_critical(path: str) -> bool:
    """Return whether a measured source file belongs to a critical boundary."""
    return path in CRITICAL_INVENTORY_FILES or path.startswith(CRITICAL_PREFIXES)


def coverage_failures(report: Mapping[str, Any]) -> list[str]:
    """Return actionable failures from a coverage.py JSON report."""
    failures: list[str] = []
    meta = report.get("meta")
    if not isinstance(meta, Mapping) or meta.get("branch_coverage") is not True:
        failures.append(
            "coverage report must be generated with branch coverage enabled"
        )

    raw_files = report.get("files")
    if not isinstance(raw_files, Mapping):
        return [*failures, "coverage report has no files map"]

    files = {normalize_path(str(path)): details for path, details in raw_files.items()}
    missing_inventory = sorted(CRITICAL_INVENTORY_FILES - files.keys())
    for path in missing_inventory:
        failures.append(f"critical file was not measured: {path}")

    for prefix in CRITICAL_PREFIXES:
        if not any(path.startswith(prefix) for path in files):
            failures.append(f"critical package was not measured: {prefix}")

    for path, details in sorted(files.items()):
        if not is_critical(path) or not isinstance(details, Mapping):
            continue
        missing_lines = details.get("missing_lines", [])
        missing_branches = details.get("missing_branches", [])
        if missing_lines:
            failures.append(f"{path} has missing lines: {missing_lines}")
        if missing_branches:
            failures.append(f"{path} has missing branches: {missing_branches}")
    return failures


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path, help="coverage.py JSON report")
    args = parser.parse_args()

    try:
        with args.report.open(encoding="utf-8") as source:
            report = json.load(source)
    except (OSError, json.JSONDecodeError) as exc:
        print(f"Critical coverage policy could not read {args.report}: {exc}")
        return 1

    failures = coverage_failures(report)
    if failures:
        print("Critical coverage policy failed:")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print("Critical coverage policy passed (100% line and branch coverage).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
