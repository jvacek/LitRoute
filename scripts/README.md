# Translation tooling and key hygiene

Read before adding i18n keys, consolidating strings, or running any of the `*-translations.py` scripts here.

## Source of truth

- `flamerelay/static/locales/en/translation.json` is the source of truth — **always add new keys there first**.
- `flamerelay/static/locales/fr/translation.json` (and any future locales) hold translator output. Direct edits to non-EN locale files in this repo are fine: **Weblate ingests them on its next sync**, and translator-side changes come back as automated GitHub-bot PRs.
- `lint-translations.py` runs as a pre-commit hook on every locale file: it sorts keys alphabetically at every level (EN included) and **drops any non-EN keys that EN no longer has** (orphaned translations from renamed/removed source strings).

## Scripts

All scripts are in `scripts/` and run from the repo root.

### `find-duplicate-translations.py`

```bash
python3 scripts/find-duplicate-translations.py
```

Pivots `translation.json` by value → keys; flags consolidation candidates. Use to find values shared by multiple keys.

### `lookup-translations.py`

```bash
python3 scripts/lookup-translations.py <key> [<key> ...]
python3 scripts/lookup-translations.py home.errors --language fr
echo "key.one\nkey.two" | python3 scripts/lookup-translations.py
```

Prints TSV (`key<TAB>value`) for one or more dot-path keys. Subtrees expand to all leaves (e.g. `home.errors` prints every `home.errors.*` line). `--language fr` reads from a different locale (defaults to `en`). Keys can be piped in via stdin.

### `translation-coverage.py`

```bash
python3 scripts/translation-coverage.py
python3 scripts/translation-coverage.py --language fr
python3 scripts/translation-coverage.py -l fr --list  # print just the missing dotted keys, one per line
```

Per-locale coverage stats and missing-key counts grouped by top-level namespace. Pipe `--list` output into `lookup-translations.py` to pull the EN source values when starting on a new namespace.

### `lint-translations.py`

```bash
python3 scripts/lint-translations.py            # rewrite in place; exit 1 if changes were made
python3 scripts/lint-translations.py --check    # dry run
```

Sorts keys and drops orphans. Default mode rewrites in place and exits 1 when changes were made, so pre-commit re-stages.

## Key hygiene

- The **`common.*` namespace** is for strings that are genuinely the same concept regardless of where they appear. **Context-sensitive duplicates** (same English today but likely to diverge in translation — e.g. a nav link vs a page heading) are intentionally kept separate.
- Use `find-duplicate-translations.py` to spot consolidation candidates.

## What stays out of translation strings

These belong **hardcoded in JSX**, not in `translation.json`:

- Decorative symbols: `♥ → ← 📍`
- Copyright notices, brand names ("LitRoute"), visual separators (`·`)
- Layout whitespace
- Trailing `…` on loading-state strings: `` `${t('common.saving')}…` ``, not in the JSON value.

## Embedded markup

Strings with embedded links or markup use `<Trans>` with **named** component tags:

```tsx
<Trans
  i18nKey="unit.supportPrompt"
  components={{ supportLink: <Link to="/support/" /> }}
/>
```

Use `<supportLink>`, never positional `<0>`.
