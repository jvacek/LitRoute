#!/usr/bin/env python3
# ruff: noqa: T201
"""
Look up source strings for a set of dot-path translation keys.

Usage:
    python3 scripts/lookup-translations.py home.headline unit.checkinBtn
    python3 scripts/lookup-translations.py --language fr home.errors
    echo "home.errors" | python3 scripts/lookup-translations.py

Reads keys from CLI args and/or stdin (one per line). Output is TSV
(`key<TAB>value`). A key that resolves to a subtree is expanded into one
line per leaf. Missing keys are printed as `key<TAB>!! MISSING` and the
script exits with status 1.

The --language flag selects which locale file to read from
(`flamerelay/static/locales/<lang>/translation.json`); defaults to `en`.
"""

import argparse
import json
import sys
from pathlib import Path

LOCALES_DIR = Path(__file__).parent.parent / "flamerelay/static/locales"


def flatten(obj: dict, prefix: str = "") -> dict[str, str]:
    out: dict[str, str] = {}
    for k, v in obj.items():
        key = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict):
            out.update(flatten(v, key))
        else:
            out[key] = str(v)
    return out


def resolve(data: dict, dotted: str) -> dict | str | None:
    node: dict | str = data
    for part in dotted.split("."):
        if not isinstance(node, dict) or part not in node:
            return None
        node = node[part]
    return node


def emit(key: str, value: str) -> None:
    escaped = value.replace("\\", "\\\\").replace("\n", "\\n").replace("\t", "\\t")
    print(f"{key}\t{escaped}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Look up dot-path keys in a locale's translation.json.")
    parser.add_argument(
        "-l",
        "--language",
        default="en",
        help="Locale code under flamerelay/static/locales/ (default: en).",
    )
    parser.add_argument("keys", nargs="*", help="Dot-path keys; subtrees expand to all leaves.")
    args = parser.parse_args()

    keys = list(args.keys)
    if not sys.stdin.isatty():
        keys.extend(line.strip() for line in sys.stdin if line.strip())

    if not keys:
        parser.print_usage(sys.stderr)
        return 2

    translation_file = LOCALES_DIR / args.language / "translation.json"
    if not translation_file.exists():
        print(f"Locale not found: {translation_file}", file=sys.stderr)
        return 2

    with open(translation_file) as f:  # noqa: PTH123
        data = json.load(f)

    missing = 0
    for key in keys:
        node = resolve(data, key)
        if node is None:
            print(f"{key}\t!! MISSING")
            missing += 1
        elif isinstance(node, dict):
            for leaf_key, leaf_value in flatten(node, key).items():
                emit(leaf_key, leaf_value)
        else:
            emit(key, str(node))

    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main())
