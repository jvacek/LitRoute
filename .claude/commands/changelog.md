---
description: Append end-user-facing changes from the current session to today's CHANGELOG.md entry
---

Update `CHANGELOG.md` (in the repo root) with any end-user-facing changes from this session.

## Procedure

1. **Find today's date** by running `date +%Y-%m-%d`. Use that exact value as the H2 heading.
2. **Survey what changed** in this session — look at the conversation, recent edits, and `git status` / `git diff` (staged + unstaged) for uncommitted work. Also check recent commits not yet reflected in the changelog with `git log --since="1 day ago" --oneline`.
3. **Filter to end-user-facing changes only.** Include anything a regular visitor would notice or care about:
   - New pages, features, or flows they can use
   - Visible UI changes (layout, copy, icons, buttons, errors they see)
   - Behaviour changes they'd feel (faster loads, better error messages, fewer prompts)
   - Bug fixes for things they could hit

   **Exclude:**
   - Admin-only or staff-only changes (`/admin/`, management commands, internal dashboards)
   - Backend refactors with no visible effect (renamed functions, moved files, type cleanups)
   - Dev tooling (CI, linters, pre-commit hooks, tests, dependency bumps unless they fix a user bug)
   - Internal docs (CLAUDE.md, ARCHITECTURE.md, FRONTEND.md, comments)
   - Infra / deploy plumbing

   If unsure whether something is user-facing, ask: "would a non-technical user notice this?" — if no, skip it.

4. **Write entries in plain, non-technical language.** Pretend you're telling a friend who uses the site, not a developer:
   - ✅ "The login screen now remembers your email between attempts."
   - ❌ "Memoize email state in Login.tsx useReducer to survive code-confirm re-renders."
   - ✅ "Maps load faster on lighter pages."
   - ❌ "Deferred maplibre vendor chunk via requestIdleCallback."

   No file paths, no function names, no library names unless the user would actually recognise them (e.g. "Google sign-in" is fine, "OAuth" is not).

5. **Update the file:**
   - If `CHANGELOG.md` already has a `## <today>` heading at the top, append new bullets to its body (keep existing content; merge with what's there).
   - If today's heading is not present, insert a new `## <today>` section at the very top of the file.
   - Use Markdown bullets (`- item`) for each change. Group related items under `### Subhead` if there are enough to warrant subsections (3+ related items); otherwise just a flat list.
   - Keep bullets short — one sentence each, ideally under 15 words.

6. **If there's nothing user-facing to log**, say so clearly and do nothing. Don't invent entries to fill space, and don't log purely internal changes just because they happened.

## Notes

- `CHANGELOG.md` is parsed at build time by `webpack/loaders/changelog-loader.js` (using `marked`) and the resulting HTML is bundled into the frontend. Each H2 becomes a card on `/changelog/`. Bullets, `### Subhead` blocks, links, `code`, and `**bold**` all render — no markdown library ships to the browser, so editing the file requires a webpack rebuild (HMR handles this in dev).
- The most recent date in the file also drives the "See what changed N days ago" chip below the navbar, so keep dates accurate.
- One entry per day is the expected cadence — keep merging into today's heading rather than creating multiple same-day entries.
