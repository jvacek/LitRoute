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

flamerelay (brand name: **LitRoute**) is a Django app for tracking "lighters" (Units) as they travel between locations. Users check in a unit with a location, up to 5 images, and a message; subscribers get email notifications; a map shows the travel history.

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

Secrets live in `.envs/.local/` (git-ignored). Do not commit these.

## Running Tests

### Python

```bash
just test                       # preferred: pytest in Docker (local tests won't work due to no local postgres)
just test -k test_name          # specific test
```

Config in `pyproject.toml` (`[tool.pytest.ini_options]`): `config.settings.test`, `--reuse-db`.

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
    locales/{en,fr}/translation.json
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

Read on demand when working in the relevant area. Do not duplicate this content here — link, don't copy.

- **Frontend / SPA / React / auth UX / brand tokens / mobile / WebAuthn**
  → `flamerelay/templates/FRONTEND.md` — authoritative for anything in `flamerelay/static/js/`.
- **Backend architecture: User model, signals, storage cleanup, permissions**
  → `backend/ARCHITECTURE.md` — read before editing `backend/models.py` or signal receivers.
- **REST API conventions and endpoint reference**
  → `backend/API.md` — read before adding/changing `/api/` endpoints. Live schema at `/api/docs/`.
- **Translation tooling and key hygiene**
  → `scripts/README.md` — read before adding i18n keys or running `scripts/*-translations.py`.
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
