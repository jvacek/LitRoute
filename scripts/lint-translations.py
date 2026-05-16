#!/usr/bin/env python3
# ruff: noqa: T201
"""
Lint translation files: alphabetically sort keys at every level of every
locale, and drop any non-EN keys that EN no longer has (stale — renamed
or removed source string).

Usage:
    python3 scripts/lint-translations.py [--check] [<file> ...]

With no file arguments, scans every `flamerelay/static/locales/*/translation.json`.
Otherwise only the listed files are processed (this is what pre-commit passes).

Default mode rewrites files in place. `--check` performs a dry run: exits 1 if
any file would change. Both modes print the affected files to stdout.

EN is the source of truth for which keys are valid; only EN gets sorted (no
stale-key check). Other locales are sorted and have any keys absent from EN
dropped — they're almost always stale (renamed or removed source string).
"""

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
LOCALES_DIR = REPO_ROOT / "flamerelay/static/locales"
EN_PATH = LOCALES_DIR / "en/translation.json"

# CLDR plural categories (i18next suffix scheme). Locales with richer plural
# rules than EN (e.g. Czech: one/few/many/other) can carry extra suffixed
# variants of any base key that is pluralized in EN.
PLURAL_SUFFIXES = ("_zero", "_one", "_two", "_few", "_many", "_other")


def walk_keys(obj: dict, prefix: str = ""):
    for k, v in obj.items():
        key = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict):
            yield from walk_keys(v, key)
        else:
            yield key


def plural_base(key: str) -> str | None:
    """If `key` ends with a CLDR plural suffix, return the base path. Else None."""
    for suffix in PLURAL_SUFFIXES:
        if key.endswith(suffix):
            return key[: -len(suffix)]
    return None


def collect_plural_bases(en_keys: set[str]) -> set[str]:
    """Base paths (without plural suffix) that have at least one plural form in EN."""
    return {base for k in en_keys if (base := plural_base(k)) is not None}


def sort_recursive(d: dict) -> dict:
    """Return a new dict with keys sorted alphabetically at every level."""
    out: dict = {}
    for k in sorted(d.keys()):
        v = d[k]
        out[k] = sort_recursive(v) if isinstance(v, dict) else v
    return out


def filter_to_en(
    en_keys: set[str],
    en_plural_bases: set[str],
    locale: dict,
    prefix: str = "",
) -> tuple[dict, list[str]]:
    """Drop any leaf paths not present in en_keys. Return (filtered, dropped_paths).

    Plural variants are kept even when the exact suffixed key is absent from EN, as
    long as the base path is pluralized in EN — locales like Czech need _few/_many
    forms that EN (one/other only) does not.
    """
    out: dict = {}
    dropped: list[str] = []
    for k, v in locale.items():
        key = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict):
            sub, sub_dropped = filter_to_en(en_keys, en_plural_bases, v, key)
            if sub:
                out[k] = sub
            elif not sub_dropped:
                # Empty dict in source with no children dropped — preserve it.
                out[k] = {}
            dropped.extend(sub_dropped)
        elif key in en_keys or ((base := plural_base(key)) is not None and base in en_plural_bases):
            out[k] = v
        else:
            dropped.append(key)
    return out, dropped


def serialize(data: dict) -> str:
    return json.dumps(data, ensure_ascii=False, indent=2) + "\n"


def discover_locale_files() -> list[Path]:
    return sorted(LOCALES_DIR.glob("*/translation.json"))


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Sort translation JSON files alphabetically and drop stale keys.",
    )
    parser.add_argument("--check", action="store_true", help="Dry run; exit 1 if any file would change.")
    parser.add_argument("files", nargs="*", type=Path, help="Files to process (defaults to all locale files).")
    args = parser.parse_args()

    targets = [Path(f).resolve() for f in args.files] if args.files else discover_locale_files()
    targets = [p for p in targets if p.is_relative_to(LOCALES_DIR) and p.name == "translation.json"]

    if not targets:
        return 0

    en_data = json.loads(EN_PATH.read_text())
    en_keys = set(walk_keys(en_data))
    en_plural_bases = collect_plural_bases(en_keys)

    changed: list[Path] = []
    had_dropped = False

    for path in targets:
        original = path.read_text()
        data = json.loads(original)

        is_en = path.resolve() == EN_PATH.resolve()
        if is_en:
            new_data = sort_recursive(data)
            dropped: list[str] = []
        else:
            filtered, dropped = filter_to_en(en_keys, en_plural_bases, data)
            new_data = sort_recursive(filtered)

        new_text = serialize(new_data)

        if dropped:
            had_dropped = True
            rel = path.relative_to(REPO_ROOT)
            print(f"{rel}: dropping {len(dropped)} stale key(s) not present in en:", file=sys.stderr)
            for k in dropped:
                print(f"  - {k}", file=sys.stderr)

        if new_text != original:
            changed.append(path)
            if not args.check:
                path.write_text(new_text)

    if changed:
        verb = "would change" if args.check else "rewrote"
        for p in changed:
            print(f"{verb} {p.relative_to(REPO_ROOT)}")

    # Fail if anything was changed (so pre-commit fails the commit and the
    # user re-stages) or if stale keys were found.
    return 1 if changed or had_dropped else 0


if __name__ == "__main__":
    sys.exit(main())
