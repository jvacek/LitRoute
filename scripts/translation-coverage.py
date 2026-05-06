#!/usr/bin/env python3
# ruff: noqa: T201
"""
Report translation coverage for non-EN locales.

Usage:
    python3 scripts/translation-coverage.py                  # all non-EN locales
    python3 scripts/translation-coverage.py --language fr    # one locale
    python3 scripts/translation-coverage.py -l fr --list     # bare key list, pipeable

Default output is a per-locale summary: total coverage plus a count of
missing keys grouped by top-level namespace. With --list, prints just the
dotted keys missing from the chosen locale (one per line) — feed it into
`scripts/lookup-translations.py` to pull EN source values for translation.
"""

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

LOCALES_DIR = Path(__file__).parent.parent / "flamerelay/static/locales"
SOURCE = "en"


def flatten(obj: dict, prefix: str = "") -> dict[str, str]:
    out: dict[str, str] = {}
    for k, v in obj.items():
        key = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict):
            out.update(flatten(v, key))
        else:
            out[key] = str(v)
    return out


def load(language: str) -> dict[str, str]:
    path = LOCALES_DIR / language / "translation.json"
    if not path.exists():
        print(f"Locale not found: {path}", file=sys.stderr)
        sys.exit(2)
    with open(path) as f:  # noqa: PTH123
        return flatten(json.load(f))


def discover_locales() -> list[str]:
    return sorted(p.name for p in LOCALES_DIR.iterdir() if p.is_dir() and p.name != SOURCE)


def missing_keys(en: dict[str, str], target: dict[str, str]) -> list[str]:
    return [k for k in en if k not in target or target[k] == ""]


def report_summary(language: str, en: dict[str, str]) -> None:
    target = load(language)
    missing = missing_keys(en, target)
    translated = len(en) - len(missing)
    pct = 100 * translated / len(en) if en else 0

    print(f"=== {language} ===")
    print(f"Coverage: {translated}/{len(en)} ({pct:.1f}%)  —  {len(missing)} missing")

    if missing:
        groups: dict[str, list[str]] = defaultdict(list)
        for k in missing:
            groups[k.split(".")[0]].append(k)
        width = max(len(ns) for ns in groups)
        print("\n  Missing by namespace:")
        for ns in sorted(groups, key=lambda n: (-len(groups[n]), n)):
            print(f"    {ns:<{width}}  {len(groups[ns])} key{'s' if len(groups[ns]) != 1 else ''}")
    print()


def report_list(language: str, en: dict[str, str]) -> None:
    target = load(language)
    for k in missing_keys(en, target):
        print(k)


def main() -> int:
    parser = argparse.ArgumentParser(description="Report translation coverage vs en/translation.json.")
    parser.add_argument("-l", "--language", help="Locale code; defaults to all non-EN locales.")
    parser.add_argument(
        "--list",
        action="store_true",
        help="Print missing keys only (one per line). Requires --language.",
    )
    args = parser.parse_args()

    en = load(SOURCE)

    if args.list:
        if not args.language:
            print("--list requires --language", file=sys.stderr)
            return 2
        report_list(args.language, en)
        return 0

    languages = [args.language] if args.language else discover_locales()
    for lang in languages:
        report_summary(lang, en)
    return 0


if __name__ == "__main__":
    sys.exit(main())
