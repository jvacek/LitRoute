# CLAUDE.md

> **For Claude:** Keep this file up to date. After any change that affects project structure, API endpoints, architectural decisions, or established conventions, update the relevant section before finishing. If a new pattern is introduced that future work should follow, document it here.
>
> **After completing any task**, ask: "Would this have been faster if the docs said X?" If yes, add X — to this file or to the relevant spec file (e.g. `FRONTEND.md`). The bar is: would a future Claude session have needed to explore or ask about this? If so, document it now.
>
> **Constants:** All magic numbers and tunable values (timeouts, TTLs, limits, thresholds) belong in `config/constants.py`. Never inline them — add the constant first, then use it. This applies proactively: if you encounter an inline magic number while working on nearby code, move it to constants as part of the same change.
> When making large plans, consider if this is realistically possible to do in one context window. If not, put the plan into an .md file in the repo's root with enough context for a subsequent agent being able to pick up when you run out of context tokens.

## Project Overview

flamerelay (brand name: **LitRoute**) is a Django app for tracking "lighters" (Units) as they travel between locations. Users check in a unit with a location, up to 5 images, and a message; subscribers get email notifications; a map shows the travel history.

## Tech Stack

### Backend

- **Python 3.14 / Django 6.0** via `uv`
  - Remember that this release accepted PEP758, which allows for exceptions to be grouped without parentheses.
- **PostgreSQL** — primary database (`ATOMIC_REQUESTS = True`)
- **Redis** — Celery broker, result backend, and production cache
- **Celery + Celery Beat** — async tasks and periodic scheduling (DB scheduler)
- **Django REST Framework + drf-spectacular** — REST API with OpenAPI 3.0 docs
- **django-allauth** — auth with MFA and headless API; **passwordless only** — magic code (OTP) + social OAuth + WebAuthn passkeys; no traditional passwords, no email verification step
- **Sentry** — production error tracking
- **MailTrap (anymail)** — production email

### Frontend

- **React 19 + TypeScript** — component-driven UI
- **Tailwind CSS v4** — utility-first styling via `@tailwindcss/postcss` PostCSS plugin (no config file; tokens in `@theme` block)
- **Webpack 5 + Node 24** — asset pipeline with `webpack-bundle-tracker` for Django integration
- **Babel** — `@babel/preset-react` (runtime: automatic) + `@babel/preset-typescript`
- **ESLint + tsc** — enforced via pre-commit hooks
- **react-i18next + i18next + i18next-browser-languagedetector** — i18n; translations live in `flamerelay/static/locales/{en,fr}/translation.json`, bundled at build time; auto-detects from `localStorage` then `navigator.language`
- **Weblate** — translation management; integrated via the Weblate GitHub bot. Weblate opens PRs against `main` when translators update strings, and ingests any direct edits to non-EN locale files on its next sync — so updating `fr/translation.json` (etc.) directly in the repo is fine; Weblate will pick the changes up. `en/translation.json` is the source of truth: always add new keys there first.

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

### Local services and ports

| Service | URL                   | Purpose                   |
| ------- | --------------------- | ------------------------- |
| Django  | http://localhost:8000 | Backend                   |
| Webpack | http://localhost:3000 | Frontend dev server (HMR) |
| Mailpit | http://localhost:8025 | Local email UI            |
| Flower  | http://localhost:5555 | Celery monitoring         |

### Environment files

Secrets live in `.envs/.local/` (git-ignored). Do not commit these.

## Running Tests

Tests run inside Docker via pytest:

```bash
just manage test                          # Django test runner (not preferred)
just test                                 # preferred: pytest directly
just test -k test_name                    # run a specific test
```

Or if running locally with `uv`:

```bash
uv run pytest
uv run coverage run -m pytest && uv run coverage html
```

Config in `pyproject.toml` (`[tool.pytest.ini_options]`): uses `config.settings.test`, `--reuse-db` enabled.

## Linting & Formatting

All linters and formatters run as pre-commit hooks (auto-run on commit). For fast local verification before finishing a change, use **`prek`** — the Rust rewrite of pre-commit, drop-in compatible with `.pre-commit-config.yaml`:

```bash
prek run --files <file> [<file> ...]   # check specific changed files
prek run --all-files                    # full sweep
```

Run `prek` after editing any file rather than reaching for individual tools — it's the canonical "did I break anything?" check and covers every hook in one pass.

The hook chain covers: **Ruff** (Python lint+format, 120-char lines), **Prettier** (JS/CSS/JSON), **ESLint** + `tsc --noEmit` (TS/TSX), **djLint** (templates), `django-upgrade`, `pyproject-fmt`, **`lint-translations`** (sorts locale JSON, drops stale keys — see Translation key hygiene), `uv-lock`.

If you want to fix a single file without the full chain:

```bash
uv run ruff check --fix <file> && uv run ruff format <file>   # .py
npx prettier --write <file> && npx eslint <file>              # .ts/.tsx/.css
```

Settings: `.prettierrc` (`singleQuote: true`, `tabWidth: 2`). Templates are excluded from Prettier.

**In JSX text, never use bare apostrophes or quotes.** The `react/no-unescaped-entities` ESLint rule rejects them. Use HTML entities instead:

- `'` → `&apos;` (e.g. `we&apos;ll`, `don&apos;t`)
- `"` → `&quot;`

Prettier does not fix this — it must be done manually when writing JSX.

## Project Structure

```
config/
  settings/         # base / local / production / test
  urls.py           # root URL config
  api_router.py     # DRF router + manual nested URL patterns for units/checkins
  constants.py      # shared business-logic constants (grace periods, etc.)
flamerelay/
  users/            # custom User model (AbstractUser, single "name" field) + API
  static/
    css/            # Tailwind entry point (project.css)
    js/             # React entry (project.tsx), components, pages, i18n.ts
    locales/
      en/translation.json   # source strings (all English)
      fr/translation.json   # Weblate target (all empty values, keys match en/)
  templates/        # spa.html (single shell) + email templates; see templates/FRONTEND.md
backend/            # Unit, CheckIn, Team models + views + DRF API
brand/              # Brand identity reference (colours, fonts, writing style)
scripts/
  find-duplicate-translations.py  # pivot translation.json by value → keys; flags consolidation candidates
TODOs/
  translations.md   # i18n migration tracking — component-by-component checklist
```

## REST API

All endpoints are under `/api/`. For the full, up-to-date endpoint reference see the live Swagger UI at **`/api/docs/`** (requires admin login in production; open in local dev).

The router is in `config/api_router.py`. All routes are registered as manual `path()` entries — the DRF router has no registered viewsets. The browsable API root (`/api/`) is therefore empty; `/api/docs/` is the authoritative reference.

### Notable endpoints

- `POST /api/auth/code/request/` — unified sign-in / sign-up. Creates the account if it doesn't exist, then triggers allauth's magic-code flow. Always returns `{"detail": "Code sent."}` regardless of whether the email was registered (anti-enumeration). Rate-limited via allauth's built-in `ratelimit.consume()`. Implemented in `flamerelay/users/api/views.py::RequestCodeView`.
- `GET /api/account/` — returns `{ username, name, is_superuser, … }` for the authenticated user. Used by `AuthContext` on every page load to populate auth state. Also supports `PATCH` (update name), `PUT`, and `DELETE` (account anonymisation). Implemented in `flamerelay/users/api/views.py::AccountView`.
- `GET /api/account/subscriptions/` — returns the list of units the authenticated user is subscribed to.
- `DELETE /api/account/social-accounts/` — disconnect a connected social OAuth account.
- `GET /api/config/` — public endpoint returning `{ maptilerKey, allowRegistration }`. Fetched once per session by `useConfig()` and cached in a module-level promise.

### API conventions

- Edit/delete grace periods are defined in `config/constants.py` (`CHECKIN_EDIT_GRACE_PERIOD_HOURS`, `CHECKIN_DELETE_GRACE_PERIOD_HOURS`).
- `SerializerMethodField` methods are annotated with Python return types so drf-spectacular generates correct schemas.
- No-body endpoints (e.g. subscribe/unsubscribe) use `@extend_schema(request=None, responses={204: None, 401: None})`.
- CheckIn responses include `created_by_name` (from `User.name`) alongside `created_by_username`.
- **Multi-image uploads**: image files are sent as repeated `multipart/form-data` fields all named `images` (`request.FILES.getlist('images')`). Maximum is `CHECKIN_MAX_IMAGES = 5` (in `config/constants.py`). On edit, existing images to remove are sent as a single JSON-encoded field `remove_image_ids` (e.g. `"[1, 3]"`). New image files are processed in `perform_create` / `partial_update` in `backend/api/views.py` — Pillow errors are caught and re-raised as `ValidationError` so the client always gets a 400 JSON response rather than a 500 HTML page.

## Key Architectural Choices

- **Custom User model**: single `name` field instead of first/last — do not add first/last name fields. `name` is the public display name everywhere (checkins, profile page, avatar initials).
- **No public user profiles**: `/profile/` shows the authenticated user's own profile only — there are no per-user public profile URLs. `UserDetailView` and `users:detail` do not exist; `User.get_absolute_url()` returns `"/profile/"`. Do not add a `<username>/` lookup route.
- **Passwordless auth**: `ACCOUNT_EMAIL_VERIFICATION = "none"`, `ACCOUNT_SIGNUP_FIELDS = ["email*"]`. No passwords. Users authenticate via: (1) magic OTP code sent to email, (2) social OAuth, or (3) a registered WebAuthn passkey. All paths land at `/accounts/login/`. The passkey flow uses `@simplewebauthn/browser` on the frontend and `allauth.mfa.webauthn` / `webauthn>=2.0` (py-webauthn) on the backend. See `FRONTEND.md → WebAuthn / Passkeys API paths` for the endpoint shapes.
- **`/accounts/signup/`** renders only for authenticated users confirming/updating their display name. Unauthenticated visitors are redirected to login. New social users are sent here by `checkNameThenRedirect()` in Login.tsx when `me.name` is blank after OAuth.
- **`ATOMIC_REQUESTS = True`**: every request is wrapped in a DB transaction.
- **AllAuth controls admin login**: admin is routed through allauth's workflow.
- **OpenAPI docs are admin-only** in production (`/api/schema/`, `/api/docs/`).
- **Celery Beat uses DB scheduler** (`django-celery-beat`) — manage periodic tasks via Django admin.
- **CORS** is restricted to `/api/*` paths only.
- **`CheckInImage` model**: `CheckIn` has no direct image field. Images live in `CheckInImage` (FK `checkin`, `related_name="images"`, ordered by `order`). Image files are stored via `ResizedImageField` (max 1024×1024, forced WEBP, quality 85). A `post_delete` signal on `CheckInImage` calls `default_storage.delete()` so files are cleaned up whenever a row is removed — whether from the API, admin, or `anonymize_user`. The signal pattern is in `backend/models.py` alongside the other `@receiver` functions. Email templates use `instance.images.first` to show the lead image.
- **Storage file cleanup pattern**: use a `post_delete` signal rather than overriding `delete()` or handling cleanup in views. Storage ops are non-transactional so keep them outside `transaction.atomic` blocks; log failures but never raise.

### Frontend Architecture

The frontend is a **true SPA**: Django serves a single `spa.html` shell for every non-API URL; React Router owns all client-side routing. There are no per-page Django views or templates (only `spa.html` and email templates remain).

**Read `flamerelay/templates/FRONTEND.md` before touching any template or React file.** It is the authoritative reference for the route→component map, auth conventions, CSRF wrappers, brand tokens, and how to add or modify pages.

Critical conventions to keep in mind:

- **Routing**: all routes are declared in `flamerelay/static/js/App.tsx`. Protected routes are wrapped in `<PrivateRoute>` — do not add auth guards inside page components.
- **Auth state**: use `useAuth()` from `AuthContext.tsx` to get `{ isAuthenticated, username, name, isSuperuser, loading, refresh }`. Never read auth state from the URL or Django template context.
- **Config**: use `useConfig()` from `lib/useConfig.ts` to get `{ maptilerKey, allowRegistration }`. Never hardcode the MapTiler key.
- **i18n**: every UI string must go through `t()` from `useTranslation()`. Never hardcode English text in JSX. See `FRONTEND.md → Internationalisation` for the full pattern reference and `TODOs/translations.md` for migration status and the detailed string-content rules. Quick rules: decorative symbols (`♥ → ← 📍`), copyright notices, brand names, visual separators (`·`), and layout whitespace all stay in JSX — never in translation strings. Strings with embedded links or markup use `<Trans>` with named component tags (`<supportLink>`, not `<0>`). `en/translation.json` is the source of truth — always add new keys there first. Direct edits to other locale files (`fr/`, etc.) are fine: Weblate ingests them on its next sync, and translator-side changes come back as automated GitHub-bot PRs. Trailing `…` on loading-state strings belongs hardcoded in JSX (e.g. `` `${t('common.saving')}…` ``), not in the JSON value.
- **Translation key hygiene**: run `python3 scripts/find-duplicate-translations.py` to find values shared by multiple keys — candidates for consolidation into `common.*`. Context-sensitive duplicates (same English today but likely to diverge in translation — e.g. a nav link vs a page heading) are intentionally kept separate. The `common.*` namespace holds strings that are genuinely the same concept regardless of where they appear.
- **Translation lookup**: run `python3 scripts/lookup-translations.py <key> [<key> ...]` to print TSV (`key<TAB>value`) for one or more dot-path keys. Subtrees expand to all leaves (e.g. `home.errors` prints every `home.errors.*` line). Pass `--language fr` to read from a different locale (defaults to `en`); keys can also be piped in via stdin. Useful when drafting translations or auditing what a namespace contains without scrolling the JSON.
- **Translation coverage**: run `python3 scripts/translation-coverage.py` to see per-locale coverage stats and missing-key counts grouped by top-level namespace. Pass `--language fr` to scope to one locale, or `-l fr --list` to print just the missing dotted keys (one per line) — pipe that into `lookup-translations.py` to pull the EN source values when starting on a new namespace.
- **Translation linting**: `scripts/lint-translations.py` runs as a pre-commit hook (also via `prek`) on every locale `translation.json`. It sorts keys alphabetically at every level (EN included) and drops any non-EN keys that EN no longer has — i.e. orphaned translations from renamed/removed source strings. Run manually with `python3 scripts/lint-translations.py [--check]` (`--check` is a dry run; default mode rewrites in place and exits 1 when changes were made, so pre-commit re-stages).
- **CSRF**: use `apiFetch` from `api.ts` for `/api/` requests. For allauth headless endpoints (`/_allauth/`), use `allauthApi.ts` which handles its own CSRF — do not use raw `fetch()` for either.
- **401 handling**: after a failed mutation returns 401, call `await refresh()` then `navigate('/accounts/login/')` — do not treat 401 as a form validation error.
- **404 handling on initial data loads**: always check `r.ok` (or `r.status`) before calling `.json()` on a GET that loads page data. DRF error bodies (`{"detail": "Not found."}`) are valid JSON — without the check they silently become the component's state. Pattern: `if (!r.ok) { setNotFound(true); return null; }` then render `<ErrorPage code={404} />` when `notFound` is true. See `Unit.tsx` and `CheckinEdit.tsx` for reference.
- **`UnitViewSet` is public read**: it uses `IsAuthenticatedOrReadOnly` so unauthenticated GET requests are allowed. All user-specific fields (`is_subscribed`, `can_check_in`) return safe defaults for anonymous users.
- **Tailwind tokens**: use named tokens (`text-amber`, `bg-char`, `font-heading`, etc.) — never raw hex values.
- **Mobile-first**: most users arrive via QR scan on a phone. Write base styles for mobile, layer `sm:`/`lg:` on top for wider screens. Verify every UI change looks correct at 375 px before calling it done. Full checklist in `FRONTEND.md` → "Mobile-first design".
- **Allauth headless**: the magic-code request goes to `POST /api/auth/code/request/` via `apiFetch` (our own endpoint). Code confirmation, MFA, and WebAuthn all use `/_allauth/browser/v1/` via `allauthApi.ts`. MFA and passkey management are inline in `UserSettings.tsx` / `PasskeySection.tsx` — no separate Bootstrap pages exist (`HEADLESS_ONLY = True` removed them all). See `FRONTEND.md → WebAuthn / Passkeys API paths` for the correct endpoint paths and response shapes — several are non-obvious (e.g. listing passkeys uses `GET /account/authenticators` filtered by type, not `GET /account/authenticators/webauthn`).
- **`StatsView` permission**: explicitly set to `AllowAny` — it inherits `IsAuthenticatedOrReadOnly` from the global default otherwise.

## Dependency Management

Uses `uv`. To add/update packages:

```bash
uv add <package>           # add runtime dependency
uv add --dev <package>     # add dev dependency
uv sync                    # sync environment from lockfile
```

After changing dependencies, rebuild the Docker image: `just build`.

### Frontend (npm)

```bash
# Run inside the node container or locally with Node 24
npm install <package>       # add dependency (updates package-lock.json)
npm install                 # sync from package-lock.json
```

After adding npm packages, the node container needs its volume refreshed. If running in Docker:

```bash
just node-reinstall
```
