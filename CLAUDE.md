# CLAUDE.md

> **For Claude:** Keep this file up to date. After any change that affects project structure, API endpoints, architectural decisions, or established conventions, update the relevant section before finishing. If a new pattern is introduced that future work should follow, document it here.
>
> **After completing any task**, ask: "Would this have been faster if the docs said X?" If yes, add X — to this file or to the relevant spec file (e.g. `flamerelay/templates/FRONTEND.md`, `backend/ARCHITECTURE.md`, `backend/API.md`, `scripts/README.md`). The bar is: would a future Claude session have needed to explore or ask about this? If so, document it now.
>
> **Constants:** All magic numbers and tunable values (timeouts, TTLs, limits, thresholds) belong in `config/constants.py`. Never inline them — add the constant first, then use it. This applies proactively: if you encounter an inline magic number while working on nearby code, move it to constants as part of the same change.
>
> When making large plans, consider if this is realistically possible to do in one context window. If not, put the plan into an .md file in the repo's root with enough context for a subsequent agent being able to pick up when you run out of context tokens.
>
> **Slice first, then flesh out.** When implementing a non-trivial plan, the first commit should be the thinnest end-to-end path that proves the idea works — happy path only, hardcoded values, minimal error handling, no edge cases. Verify the slice runs and produces the expected outcome before layering on details, validation, additional logic, or polish. This catches bad assumptions early, while the change is still cheap to throw away.

## Project Overview

flamerelay (brand name: **LitRoute**) is a Django app for tracking "lighters" (Units) as they travel between locations. Users check in a unit with a location, up to 5 images, and a message; followers get email notifications; a map shows the travel history.

## Tech Stack

- **Backend:** Python 3.14 / Django 6.0 via `uv`; PostgreSQL (`ATOMIC_REQUESTS = True`); Redis (Celery broker + cache); Celery + Celery Beat (DB scheduler); DRF + drf-spectacular; django-allauth (passwordless: magic OTP + social OAuth + WebAuthn); Sentry; MailTrap (anymail).
- **Frontend:** React 19 + TypeScript; Tailwind CSS v4 (`@tailwindcss/postcss`, no config file, tokens in `@theme`); Webpack 5 + Node 24 with `webpack-bundle-tracker`; Babel (`@babel/preset-react` automatic + `@babel/preset-typescript`); ESLint + tsc enforced via pre-commit; react-i18next (translations bundled at build time); Weblate via GitHub bot.
- **Python 3.14 note:** PEP 758 is accepted — exceptions can be grouped without parentheses.

## Local Development

All local dev runs through Docker. Use `just` commands (see `justfile`):

```
just build          # build Docker images
just up             # start all containers (detached)
just down           # stop containers
just logs           # tail logs for all services
just logs django    # tail logs for a specific service
just manage <cmd>   # run manage.py commands, e.g. `just manage migrate`
just prune          # remove containers AND volumes (destructive)
```

| Service | URL                   | Purpose                   |
| ------- | --------------------- | ------------------------- |
| Django  | http://localhost:8000 | Backend                   |
| Webpack | http://localhost:3000 | Frontend dev server (HMR) |
| Mailpit | http://localhost:8025 | Local email UI            |
| Flower  | http://localhost:5555 | Celery monitoring         |

**Browser-based UI testing (Chrome DevTools MCP, manual smoke tests) always uses port 3000, never 8000.** The Django shell on :8000 has a SPA catch-all route that returns `text/html` for unknown paths — including hashed webpack bundle URLs — which causes the page to render blank with MIME-type errors in the console. The webpack dev server on :3000 serves the bundles directly with correct MIME types and proxies `/api/` to Django. Curl/API checks against :8000 are fine; only Chrome-rendered pages need :3000.

Secrets live in `.envs/.local/` (git-ignored). Do not commit these.

## Running Tests

### Python

```bash
just test                       # preferred: pytest in Docker (local tests won't work due to no local postgres)
just test -k test_name          # specific test
just test backend/tests/api/    # request layer only
```

Config in `pyproject.toml` (`[tool.pytest.ini_options]`): `config.settings.test`, `--reuse-db`.

**Before adding or modifying a test, read `backend/TESTING.md`.** It defines the request-vs-logic-layer split, the shared fixtures (`client`, `user`, `unit`, `auth_client`, `make_checkin`, `mute_emails`, `clear_cache`), the canonical `UserFactory` location, and the rules against re-testing Django/DRF/AllAuth internals.

### JS/TS

```bash
npm test
```

## Linting & Formatting

Use **`prek`** (Rust rewrite of pre-commit, drop-in compatible with `.pre-commit-config.yaml`) after every change — it's the canonical "did I break anything?" check:

```bash
prek run --files <file> [<file> ...]   # check specific changed files
prek run --all-files                   # full sweep
```

The hook chain covers: Ruff (Python, 120-char), Prettier (JS/CSS/JSON), ESLint + `tsc --noEmit`, djLint, django-upgrade, pyproject-fmt, `lint-translations`, `uv-lock`. Templates are excluded from Prettier.

**JSX text never uses bare apostrophes or quotes.** ESLint's `react/no-unescaped-entities` rejects them and Prettier won't fix it. Use `&apos;` for `'` and `&quot;` for `"`.

**Translation JSON values use real characters, not HTML entities.** The JSX rule above does NOT apply to `flamerelay/static/locales/*/translation.json` — those values are inserted into the DOM as raw strings via `t()`, so `&apos;` would render literally as `&apos;`. Write `lighter's` not `lighter&apos;s` in JSON.

## Project Structure

```
config/
  settings/         # base / local / production / test
  urls.py           # root URL config
  api_router.py     # DRF router + manual nested URL patterns
  constants.py      # shared business-logic constants
flamerelay/
  users/            # custom User model + API
  static/
    css/            # Tailwind entry point (project.css)
    js/             # React entry, components, pages, i18n.ts
    locales/<lang>/translation.json   # bundled set declared in static/js/i18n.ts
  templates/        # spa.html (single shell) + email templates + FRONTEND.md
backend/            # Unit, CheckIn, Team models + DRF API + ARCHITECTURE.md + API.md
brand/              # Brand identity reference + TRANSLATOR_GUIDE.md
scripts/            # translation tooling + favicons; see scripts/README.md
TODOs/              # task trackers
```

## Critical Rules

- **Custom User model has only `name`** — no `first_name`/`last_name`. No public user profiles; `User.get_absolute_url()` → `/profile/`. Do not add a `<username>/` route.
- **Passwordless auth only** (`ACCOUNT_EMAIL_VERIFICATION = "none"`). Magic OTP + social OAuth + WebAuthn passkeys. No password forms. No email verification step.
- **`ATOMIC_REQUESTS = True`** — every request is wrapped in a DB transaction. Storage operations are non-transactional; keep them outside `transaction.atomic` blocks.
- **CSRF wrappers:** `apiFetch` from `api.ts` for `/api/` endpoints; `allauthApi.ts` for `/_allauth/` endpoints. **Never raw `fetch()`** for either.
- **Tailwind:** named tokens only (`text-amber`, `bg-char`, `font-heading`) — never raw hex values.
- **i18n:** every UI string goes through `t()` from `useTranslation()`. `en/translation.json` is the source of truth — always add new keys there first.
- **Frontend SPA:** Django serves a single `spa.html` shell for every non-API URL; React Router owns all client-side routing. There are no per-page Django views or templates.

## Documentation Map

**Read the relevant doc before exploring code or planning changes** — not after, not "if needed". These files exist precisely so you don't have to rediscover conventions by grepping. If your task touches an area below, the corresponding doc is a prerequisite, not optional reading. Do not duplicate this content here — link, don't copy.

- **Touching React UI, SPA routing, loaders, brand tokens, mobile rules, performance hints**
  → **read `flamerelay/templates/FRONTEND.md` first.** Has an index at the top — descend into a sibling doc if your task is auth- or i18n-specific.
- **Auth UX — login, signup, social, WebAuthn / passkeys, MFA**
  → **read `flamerelay/static/js/AUTH.md` first.**
- **i18n strings, locales, translation conventions**
  → **read `flamerelay/static/js/I18N.md` first.** Translation tooling (lint hook, coverage, lookup) lives in `scripts/README.md`.
- **Touching `backend/models.py`, signals, auth, permissions, or storage cleanup**
  → **read `backend/ARCHITECTURE.md` first.**
- **Adding, modifying, or testing any `/api/` endpoint**
  → **read `backend/API.md` first.** Live schema at `/api/docs/`. After any serializer/viewset change, run `just specs` and commit both `openapi.yaml` and `flamerelay/static/js/api/schema.d.ts` — CI's linter job re-runs the TS gen and diffs against the committed file, so drift fails the build.
- **Writing or refactoring any test under `backend/tests/` or `flamerelay/users/tests/`**
  → **read `backend/TESTING.md` first.** Layered structure, shared fixtures, FIRST-U rules, anti-patterns.
- **Adding i18n keys or running `scripts/*-translations.py`**
  → **read `scripts/README.md` first.**
- **Brand voice / translator tone** → `brand/TRANSLATOR_GUIDE.md`
- **Security audit snapshot** → `SECURITY.md`

## Dependency Management

```bash
uv add <package>           # runtime dependency
uv add --dev <package>     # dev dependency
uv sync                    # sync from lockfile if out of sync
```

After changing dependencies, rebuild the Docker image: `just build`.

Frontend (npm, Node 24): `npm install <package>`. After adding npm packages in Docker, refresh the node container volume: `just node-reinstall`.
