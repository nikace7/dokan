"""Enforce the project's 400-line boundary for hand-written source files."""

from __future__ import annotations

import sys
from pathlib import Path
from subprocess import check_output

MAX_LINES = 400
ROOTS = ("backend", "frontend", "storefront", "e2e")
SUFFIXES = {".py", ".js", ".jsx", ".ts", ".tsx"}
EXEMPT = {Path("frontend/src/lib/api/schema.d.ts")}


def source_files(repository: Path) -> list[Path]:
    tracked = check_output(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", *ROOTS],
        cwd=repository,
        text=True,
        encoding="utf-8",
    ).splitlines()
    relative_paths = (Path(value) for value in tracked)
    return sorted(
        repository / path
        for path in relative_paths
        if path.suffix in SUFFIXES and path not in EXEMPT
    )


def line_count(path: Path) -> int:
    with path.open(encoding="utf-8") as source:
        return sum(1 for _line in source)


def main() -> int:
    repository = Path(__file__).resolve().parents[1]
    counts = ((path, line_count(path)) for path in source_files(repository))
    violations = [
        (path.relative_to(repository), count) for path, count in counts if count > MAX_LINES
    ]
    if not violations:
        print(f"Source-size policy passed ({MAX_LINES} lines maximum).")
        return 0

    print(f"Hand-written source files must stay at or below {MAX_LINES} lines:")
    for path, count in sorted(violations, key=lambda item: (-item[1], str(item[0]))):
        print(f"  {count:>4}  {path.as_posix()}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
