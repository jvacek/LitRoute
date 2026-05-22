# Frontend Architecture

Django serves a **single HTML shell** (`flamerelay/templates/spa.html`) for every non-API URL. React Router owns all client-side routing. There are no per-page Django views or templates — `spa.html` and the transactional email templates are the only `.html` files.

`/api/`, `/_allauth/`, and `/admin/` are handled entirely server-side and are unaffected by client-side routing.

## Route → component map

All routes are declared in `flamerelay/static/js/App.tsx` via `createBrowserRouter(createRoutesFromElements(...))` + `<RouterProvider>`. The `<Layout>` wrapper (Navbar + footer) wraps every route. Routes marked **PrivateRoute** redirect unauthenticated users to `/accounts/login/?next=<path>`. Routes marked **Loader** fetch their initial data via a React Router 7 `loader` — see _Data loading (route loaders)_ below.

| URL                                    | React component                                                 | Auth         | Loader |
| -------------------------------------- | --------------------------------------------------------------- | ------------ | ------ |
| `/`                                    | `pages/Home.tsx`                                                | —            | ✓      |
| `/about/`                              | `pages/About.tsx`                                               | —            |        |
| `/accounts/login/`                     | `pages/Login.tsx` — unified sign-in **and** sign-up             | —            |        |
| `/accounts/signup/`                    | `pages/Signup.tsx` — name confirmation for authenticated users  | —            |        |
| `/accounts/confirm-email/:key`         | `pages/EmailConfirm.tsx`                                        | —            |        |
| `/unit/:identifier/`                   | `pages/Unit.tsx`                                                | —            | ✓      |
| `/unit/:identifier/checkin`            | `pages/CheckinCreate.tsx`                                       | PrivateRoute | ✓      |
| `/unit/:identifier/checkin/:checkinId` | `pages/CheckinEdit.tsx`                                         | PrivateRoute | ✓      |
| `/game/:gameId/leaderboard/`           | `pages/GameLeaderboard.tsx`                                     | —            | ✓      |
| `/profile/`                            | `pages/UserDetail.tsx` — own profile only                       | PrivateRoute | ✓      |
| `/profile/update/`                     | `pages/UserForm.tsx`                                            | PrivateRoute | ✓      |
| `/profile/settings/`                   | `pages/UserSettings/` — profile, email, MFA, connected accounts | PrivateRoute |        |
| `/socialconnect/`                      | `pages/SocialConnections.tsx`                                   | PrivateRoute |        |
| `*`                                    | `pages/ErrorPage.tsx` (code=404)                                | —            |        |

## Auth state (AuthContext)

`flamerelay/static/js/AuthContext.tsx` wraps the app in `<AuthProvider>`. On mount it calls `GET /api/account/` and stores the result. Use the `useAuth()` hook in any component:

```tsx
const { isAuthenticated, username, name, isSuperuser, loading, refresh } =
  useAuth();
```

- `loading` is `true` until the initial `/api/account/` call resolves — gate any auth-dependent render behind it.
- Call `await refresh()` after any action that changes auth state (login, logout, name save).
- After a mutation returns 401 (session expired), call `await refresh()` then `navigate('/accounts/login/')`.

`PrivateRoute` (`flamerelay/static/js/PrivateRoute.tsx`) renders a loading state while `loading` is true, then redirects to `/accounts/login/?next=<full-path>` if not authenticated. Do not add auth guards inside page components — add a `<PrivateRoute>` wrapper in `App.tsx` instead.

## Global config (useConfig)

App-wide runtime config (MapTiler key, Turnstile site key, registration flag) is sourced from the **root route loader** in `pages/root.loader.ts`. The loader fetches `GET /api/config/` once per page load (singleton-cached promise) and resolves before any descendant route renders, so `useConfig()` always returns a non-null `Config`:

```tsx
const { maptilerKey, turnstileSiteKey, allowRegistration } = useConfig();
```

If `/api/config/` fails, the loader reports it via `reportError`, clears the cache so the next navigation can retry, and returns a fallback `{ maptilerKey: '', allowRegistration: false, turnstileSiteKey: '' }`. Consumers do not need null-checks or `?? ''` defenses — the loader guarantees the contract.

Never hardcode the MapTiler key — always read it from `useConfig()`.

## Data loading (route loaders)

Pages that need data on first paint fetch it via a **React Router 7 loader**, not a `useEffect`. The browser starts the loader the moment navigation begins, in parallel with the lazy route chunk download — so the API request and the JS chunk arrive together instead of the request only firing after the component mounts.

### File layout

The loader lives in its own file next to the page, **separate from the lazy component**:

```
pages/Unit.tsx          ← React.lazy() in App.tsx, big chunk
pages/Unit.loader.tsx   ← eager import in App.tsx, tiny (just the fetch)
```

If the loader lived inside the page file, it would only become available after the chunk loaded — defeating the parallelism. Keep loaders in `<Page>.loader.ts` (or `.tsx` if you also export an `errorElement` component).

### Typed API client

Loaders call the API through `apiClient` from `flamerelay/static/js/api/client.ts` — an `openapi-fetch` instance wrapping `apiFetch` so CSRF + cookies still work. Types come from `flamerelay/static/js/api/schema.d.ts`, regenerated by `just specs` from the live OpenAPI schema (commits both `openapi.yaml` and `schema.d.ts`; CI fails the build if the checked-in artifacts drift).

```ts
import { apiClient } from '../api/client';
import type { components } from '../api/schema';

export type UnitLoaderData = {
  unit: components['schemas']['Unit'];
  checkins: components['schemas']['CheckIn'][];
};

export async function unitLoader({ params }: LoaderFunctionArgs): Promise<UnitLoaderData> {
  const identifier = params.identifier ?? '';
  const [unitResp, checkinsResp] = await Promise.all([
    apiClient.GET('/api/units/{identifier}/', { params: { path: { identifier } } }),
    apiClient.GET('/api/units/{identifier}/checkins/', { params: { path: { identifier } } }),
  ]);
  if (unitResp.response.status === 404 || !unitResp.data) {
    throw new Response('Unit not found', { status: 404 });
  }
  return { unit: unitResp.data, checkins: checkinsResp.data ?? [] };
}
```

`apiClient.GET` returns `{ data, error, response }` and **never throws on non-2xx** — check `response.status` or `data` and `throw new Response(...)` to surface a routed error.

### Consuming loader data in the page

```ts
import { useLoaderData } from 'react-router-dom';
import type { UnitLoaderData } from './Unit.loader';

const { unit, checkins } = useLoaderData() as UnitLoaderData;
```

The route component re-mounts on pathname changes (the per-pathname `key={pathname}` wrappers in Layout ensure this), so seeding local state from loader data via `useState(() => loaderData.something)` is safe — the initialiser re-runs on navigation.

### 404 and other expected failures

A loader that `throw`s a `Response` with a 4xx status is caught by the route's `errorElement`. Pattern (see `pages/Unit.loader.tsx`):

```tsx
export function UnitErrorElement() {
  const error = useRouteError();
  if (!isRouteErrorResponse(error) || error.status !== 404) throw error;
  return <NotFoundUI />;
}
```

Wire both `loader` and `errorElement` on the `<Route>` in App.tsx:

```tsx
<Route
  path="/unit/:identifier/"
  element={<Unit />}
  loader={unitLoader}
  errorElement={<UnitErrorElement />}
/>
```

Non-404 errors `throw error` to bubble to the parent error boundary (the per-route `<ErrorBoundary>` in Layout).

### App-wide resources (root loader)

For data that's stable across navigation and needed in many routes, use the **root route loader** (`pages/root.loader.ts`) instead of a per-page loader. The root `<Route id="root">` resolves before any descendant renders, so consumers can rely on a non-null value with no defensive checks. Cache the fetch in a module-level singleton promise so the endpoint is hit at most once per page load — React Router re-invokes parent loaders on every navigation, and the singleton makes those invocations free.

Currently this pattern hosts `/api/config/`. The runtime contract for adding a new app-wide resource is:

1. Fetch it in `pages/root.loader.ts` under the same singleton-cached pattern, with a soft-fail fallback if it must not block the app.
2. Add a typed accessor hook in `lib/` that reads via `useRouteLoaderData('root')`. See `lib/useConfig.ts`.

### When to use a loader vs. a useEffect

Use a **loader** when the data is required for the first paint and the page can't render meaningfully without it.

Keep a **`useEffect`** when:

- The fetch is intentionally lazy / fire-and-forget (the leaderboard rank on Unit takes ~5 min cache misses; we don't want it blocking the page).
- The fetch depends on AuthContext (loaders can't access React context — `PrivateRoute` runs after the loader).
- The fetch is triggered by a user action (mutations stay in handlers, not loaders).

### Generated types and runtime mismatches

`openapi-typescript` is honest — if the schema says a field is required but runtime returns `null`, the generated types lie. When you find a mismatch, fix it in the **serializer** (e.g. `allow_null=True` on nested serializers) and re-run `just specs`. Don't paper over the mismatch with hand-typed intersection types — the whole point of generating from the schema is that the schema becomes the contract.

## Error pages

- **Per-route loader errors (e.g. 404 on `/unit/:identifier/`)** — handled by the route's `errorElement`, which catches anything the loader throws. See _Data loading (route loaders) → 404 and other expected failures_.
- **Catch-all 404** — the trailing `<Route path="*">` in `App.tsx` renders `<ErrorPage code={404} />` for unmatched paths.
- **500 (uncaught render error)** — `App.tsx` has two `<ErrorBoundary>` layers. The **outer** boundary (wrapping `<AuthProvider>`) catches crashes in the shell — Navbar, Footer, AuthProvider — and replaces the whole app with `<ErrorPage code={500} />`. The **inner** boundary (`<ErrorBoundary key={pathname}>` inside Layout's `<Suspense>`) catches page-level crashes so a broken route doesn't kill navigation; the `key={pathname}` re-mounts it on every nav so a caught error doesn't poison subsequent routes.
- **Django server errors** (e.g. 500 before React loads) — Django's own error handler; these are rare since the SPA shell has no server-side logic.

`ErrorPage` derives headline and description from the `code` prop. Pass `code={403}` for permission errors, `code={500}` for unexpected failures. Use `text-amber` for 404 and `text-ember` for 403/500 (the component handles this internally).

## Performance hints

### Preload pipeline (entry-path chunks)

QR-landing routes (`/`, `/unit/:id/`, `/accounts/login/`) emit `<link rel="preload" as="script">` hints from the SPA shell so the browser fetches the route chunk in parallel with the entry script instead of serially after it. Fonts above the fold get the same treatment with `as="font"`. URLs are resolved from `webpack-stats.json` at request time so deploy-time hash changes don't break the hints.

Wiring lives across four files:

1. **`flamerelay/static/js/App.tsx`** — wrap the lazy import with a `webpackChunkName` magic comment so the chunk emits with a stable filename. Webpack's prod default (`chunkIds: 'deterministic'`) otherwise emits numeric IDs like `940-<hash>.js` that the helper can't match.
   ```ts
   const Foo = lazy(() => import(/* webpackChunkName: "pages-Foo" */ './pages/Foo'));
   ```
2. **`flamerelay/utils/preload.py`** — add a `_CHUNK_PREFIX` constant and a `request.path`-keyed mapping in `get_preload_hints()`.
3. **`flamerelay/utils/tests/test_preload.py`** — add a test case stubbing `_load_stats` with a fake `assets` entry matching the new prefix. The resolver fails silently when prefixes drift, so this test is load-bearing.
4. **`flamerelay/templates/spa.html`** — already renders `preload_scripts` + `preload_fonts` from the context processor. No changes needed when adding a new route.

**Only add routes the user lands on cold** — QR scans, magic-link emails, direct URL share. Routes reached via in-app navigation already have the entry loaded; a preload there is wasted bandwidth.

### Image priority hints

- **LCP image** (the largest above-the-fold image on a route): `fetchPriority="high"` + `decoding="async"`. See `pages/Unit.tsx` hero image.
- **Below-the-fold images**: `loading="lazy"` + `decoding="async"`.
- **Carousel slides** (`components/ImageCarousel.tsx`): first slide `loading="eager"`, subsequent slides `loading="lazy"`.

### Bundle-size budgets

The `size-limit` block in `package.json` enforces brotli-compressed budgets on `npm run build` output. CI runs `npm run size` after `npm run build` and fails the linter job if a budget trips.

If a budget trips, the options are: (a) trim the offender, (b) push the cost behind a lazy boundary, (c) revise the budget upward with a one-line note in the PR explaining what changed. Don't silently bump the budget — the gate exists to surface bloat for review.

When adding a new lazy route whose chunk merits its own budget (heavy deps, public-facing fast path), add a corresponding entry to the `size-limit` block.

## CSRF

There are three CSRF-aware ways to call our APIs — pick by use case:

- **Loaders and any typed `/api/` GET** — use `apiClient` from `api/client.ts`. Typed via the generated OpenAPI schema; wraps `apiFetch` so CSRF still works. See _Data loading (route loaders)_.
- **Mutations against `/api/` (POST/PATCH/DELETE)** — use `apiFetch` from `api.ts` directly. Injects `X-CSRFToken` automatically on mutating methods. Returns the raw `Response` for the `r.ok` check.
- **`/_allauth/` endpoints** — use the functions in `lib/allauthApi.ts`. They handle their own CSRF internally.

```ts
// Typed GET — preferred when you have a schema entry for the endpoint
import { apiClient } from '../api/client';
const { data, error } = await apiClient.GET('/api/account/');

// Untyped mutation — when you need raw control over body/headers
import { apiFetch } from '../api';
await apiFetch(`/api/units/${identifier}/follow/`, { method: 'POST' });

// Allauth
import { logout } from '../lib/allauthApi';
await logout(); // calls DELETE /_allauth/browser/v1/auth/session
```

Never call `fetch()` directly for either API — not for GETs on authenticated endpoints, not for mutations.

**`apiFetch` never throws on non-2xx.** It always returns the raw `Response`. Always check `r.ok` before updating local state. For destructive actions that already use `confirm()`, the established pattern is:

```ts
const r = await apiFetch(`/api/…`, { method: 'DELETE' });
if (!r.ok) {
  const body = await r.json().catch(() => ({}));
  alert(body?.detail ?? 'Fallback message.');
  return;
}
// only update local state here
setItems((prev) => prev.filter((x) => x.id !== id));
```

DRF puts the human-readable reason in `detail` for permission/grace-period errors, so `body?.detail` is almost always the right message to surface.

### 404 on initial data loads

Initial-load 404s are handled by the route's loader + `errorElement` — see _Data loading (route loaders)_ above. The old `setNotFound(true)` + `<ErrorPage code={404} />` pattern in component state is gone from the loader-migrated pages.

For mutations and lazy fetches that stay in `useEffect`, **always check `r.ok` before calling `.json()`** — DRF error bodies (`{"detail": "Not found."}`) are valid JSON, so without the check they silently become the component's state.

### 401 handling

After a failed mutation returns 401, call `await refresh()` then `navigate('/accounts/login/')` — do not treat 401 as a form validation error.

## Internationalisation (i18n)

The frontend uses **react-i18next** for all UI strings. Translations are bundled at build time (no HTTP backend) — webpack imports the JSON files directly.

### Files

| Path | Purpose |
|---|---|
| `flamerelay/static/locales/en/translation.json` | Source of truth — all English strings, nested by feature area |
| `flamerelay/static/locales/fr/translation.json` | Weblate target — identical structure, all values `""` |
| `flamerelay/static/js/i18n.ts` | i18next init (LanguageDetector, resources, `fallbackLng: 'en'`) |
| `flamerelay/static/js/components/LanguagePicker.tsx` | Language selector rendered in `Navbar.tsx` |

`i18n.ts` is imported once in `project.tsx` before the React render. The `initReactI18next` plugin wires i18next into the React context — no `<I18nextProvider>` is needed.

### Auto-detection

`i18next-browser-languagedetector` runs on mount. Detection order: `['localStorage', 'navigator']`. The user's choice (from `LanguagePicker`) is persisted to `localStorage` automatically.

### Using translations in components

```tsx
import { Trans, useTranslation } from 'react-i18next';

export default function MyComponent() {
  const { t, i18n } = useTranslation();

  // Plain string
  return <p>{t('section.key')}</p>;

  // Interpolation
  return <p>{t('unit.status.currentlyIn', { place })}</p>;

  // Plural (keys: section.key_one / section.key_other)
  return <p>{t('unit.status.lastSeenDaysAgo', { count: days, place })}</p>;

  // Embedded JSX (links, <strong>, custom spans) — use <Trans>
  return (
    <Trans
      i18nKey="unit.supportPrompt"
      components={{ supportLink: <Link to="/support/" className="…" /> }}
    />
  );

  // Date locale — always use resolved language, never hardcode 'en-GB'
  return <span>{date.toLocaleDateString(i18n.resolvedLanguage, { … })}</span>;
}
```

### Non-hook contexts (helper functions, event handlers)

Import the i18n singleton directly — `useTranslation()` only works inside React components:

```ts
import i18n from '../i18n'; // adjust relative path
i18n.t('unit.deleteConfirm');
```

But prefer moving the function **inside** the component so it can use the `t` from `useTranslation()` — that picks up language changes reactively.

### Key naming conventions

- Nested by feature area: `nav.*`, `footer.*`, `home.*`, `auth.*`, `unit.*`, `checkin.*`, `settings.*`, etc.
- Plurals: i18next `_one` / `_other` suffix — e.g. `unit.status.lastSeenDaysAgo_one` / `unit.status.lastSeenDaysAgo_other`
- `<Trans>` component tags in keys use lowercase descriptive names — e.g. `<supportLink>`, `<strong>`, `<handwriting>`

### What needs a translation key

Add a key for anything a translator would need to change. **Do not** add a key for:

- Universal symbols and punctuation — `*`, `©`, `→`, `←`, `…`
- Copyright notices — hardcode as `© {new Date().getFullYear()} LitRoute` (year stays dynamic, brand name is not translated)
- Brand names used in isolation — "LitRoute" is always "LitRoute"
- Purely numeric values or codes

### Adding a new string

1. Add the key + English value to `flamerelay/static/locales/en/translation.json` under the appropriate section.
2. Use `t('your.key')` or `<Trans i18nKey="your.key" …>` in the component.
3. Weblate picks up new keys automatically and keeps target locale files in sync — no manual edits to `fr/translation.json` needed.

### Migration status

Not all components are migrated yet. See `TODOs/translations.md` for the per-component checklist and conventions for tricky cases (static arrays with JSX answers, functions that need `t()`, etc.).

## Adding a new React page

1. Create `flamerelay/static/js/pages/MyPage.tsx` — export a default component. Use `useParams()` for URL segments, `useAuth()` for auth state, `useConfig()` for API keys.
2. **If the page fetches data on first paint**, create `flamerelay/static/js/pages/MyPage.loader.ts(x)` next to it with a `myPageLoader` function and (if there's an expected 404) a `MyPageErrorElement`. See _Data loading (route loaders)_. Consume the result with `useLoaderData() as MyPageLoaderData` — do not fetch in `useEffect`.
3. Add a `<Route>` in `App.tsx` with `loader={myPageLoader}` (and `errorElement={<MyPageErrorElement />}` if applicable). Wrap in `<PrivateRoute>` if login is required. If the page is heavy (large dep, e.g. maplibre, qrcode, @simplewebauthn), use `lazy()` so it ships as its own chunk — but **keep the loader import eager** (that's why the loader lives in a separate file).
4. No Django view needed — the catch-all `spa_view` in `config/urls.py` handles all non-API routes automatically.
5. **If this is a QR-landing fast path** (a route users hit cold from outside the app), wire it through the preload pipeline — see _Performance hints → Preload pipeline_ above.

```tsx
// App.tsx — add inside the <Route element={<Layout />}> block
import { myPageLoader, MyPageErrorElement } from './pages/MyPage.loader';
const MyPage = lazy(() => import(/* webpackChunkName: "pages-MyPage" */ './pages/MyPage'));

<Route
  path="/my-page/:id/"
  element={
    <PrivateRoute>
      <MyPage />
    </PrivateRoute>
  }
  loader={myPageLoader}
  errorElement={<MyPageErrorElement />}
/>
```

## Frontend tests

Unit tests live in `flamerelay/static/js/__tests__/`. Run them with:

```bash
npm test
```

The test suite uses **Jest + babel-jest** (reuses the existing Babel config) with `jest-environment-jsdom`. `@testing-library/react` and `@testing-library/jest-dom` are available — import `'@testing-library/jest-dom'` at the top of any component test file (there is no global setup file).

**Existing test files:**

- `api.test.ts` — `getCsrfToken` (cookie regex edge cases) and `apiFetch` (CSRF header injection per HTTP method)
- `allauthApi.test.ts` — `hasPendingFlow` (all conditional branches) and `redirectToProvider` (DOM form construction, CSRF field, and `callbackUrl` validation)
- `PasskeySection.test.tsx` — full component test for the passkey management UI; covers all view transitions (list → adding → reauth), error states, and API call arguments. Uses `jest.mocked()` to type API mocks and `@simplewebauthn/browser` mocks.

**When to add component tests:** use `@testing-library/react` when a component has a non-trivial state machine (multiple views, conditional flows, error paths). Pure fetch wrappers and utility functions are better covered with plain unit tests. Mock module imports with `jest.mock('path/to/module')` and type them with `jest.mocked(fn)`. Use `screen.findBy*` (async) for anything that waits on a resolved promise; `screen.getBy*` (sync) only for elements that render immediately.

## Checking pages with Chrome DevTools MCP

When the local stack is running (`just up`), use the Chrome DevTools MCP tools to visually verify UI changes. **Always use port 3000** — that is the webpack dev server with HMR, which serves the live-reloading frontend. Port 8000 (Django) also works but won't reflect in-progress frontend changes without a page reload.

Typical workflow:

```
mcp__chrome-devtools__navigate_page  →  http://localhost:3000/<path>
mcp__chrome-devtools__take_screenshot  →  verify layout / styles
mcp__chrome-devtools__get_console_message / list_console_messages  →  check for JS errors
```

### Pre-seeded test data

A unit with identifier **`john-93`** is seeded in the dev database with example check-ins, images, and travel history. Use it to test the unit page without creating data manually:

- Unit page: `http://localhost:3000/unit/john-93/`
- Check-in create: `http://localhost:3000/unit/john-93/checkin`

## Mobile-first design

**Most users arrive on a phone** — they scan a QR sticker on a lighter and land straight on the Unit page. Design for that context first.

### Default approach

- Write the **base (unprefixed) styles for mobile** and layer `sm:` / `lg:` on top for wider viewports. Never write desktop styles first and try to undo them on mobile.
- Target **375 px** as the smallest supported viewport (iPhone SE / older Android). Content should be readable and functional at that width with no horizontal scroll.
- Tap targets must be **at least 44 × 44 px** — buttons, links, and interactive icons. Use generous `py-` and `px-` padding rather than relying on the text alone.
- Avoid interactions that only work on hover (`hover:` utilities are fine as an enhancement but the element must be fully usable without them).
- Keep font sizes readable on mobile: body copy `text-base` (16 px) as a floor; `text-sm` only for supporting metadata (dates, labels). Never use `text-xs` for anything the user needs to read to understand a page.

### Key breakpoints

| Prefix   | Min-width | Typical use                                  |
| -------- | --------- | -------------------------------------------- |
| _(none)_ | 0 px      | Mobile — the primary layout                  |
| `sm:`    | 640 px    | Two-column layouts, side images, wider cards |
| `lg:`    | 1024 px   | Full desktop layouts, wider max-widths       |

### Checklist before calling a UI change done

- [ ] Does it look correct at 375 px width? (Chrome DevTools → device toolbar, or `sm` breakpoint in Tailwind)
- [ ] Are all tap targets large enough?
- [ ] Does any absolutely/fixed-positioned element overlap content on small screens?
- [ ] If the layout is `flex-row` on desktop, does `flex-col` (mobile stacking order) make sense?

## Brand tokens

Declared in `flamerelay/static/css/project.css` under `@theme`. Use these class names — never raw hex values.

| Token        | Tailwind classes        | Value     |
| ------------ | ----------------------- | --------- |
| Amber Gold   | `text-amber` `bg-amber` | `#e8a030` |
| Char (dark)  | `text-char` `bg-char`   | `#1c1a15` |
| Ember Red    | `text-ember` `bg-ember` | `#c94c35` |
| Smoke Blue   | `text-smoke` `bg-smoke` | `#7b8fa1` |
| Parchment    | `bg-parchment`          | `#faf6ee` |
| Warm Linen   | `bg-linen`              | `#f0ead8` |
| Heading font | `font-heading`          | Fraunces  |
| Body font    | `font-body`             | DM Sans   |

Tailwind scans `../js/**/*.{ts,tsx}` and `../../templates/**/*.html` via `@source` directives — no safelisting needed.

## Component style system

The project uses an explicit design-token layer on top of Tailwind to avoid generic defaults and keep the visual language consistent. There are two places tokens are defined.

### Radius tokens (`project.css`)

Three `@theme` variables generate Tailwind utility classes:

| CSS variable     | Tailwind class  | Value | Used on                           |
| ---------------- | --------------- | ----- | --------------------------------- |
| `--radius-btn`   | `rounded-btn`   | 4 px  | All interactive buttons           |
| `--radius-input` | `rounded-input` | 4 px  | Text inputs and textareas         |
| `--radius-card`  | `rounded-card`  | 6 px  | Content cards and auth containers |

Never use `rounded-lg` / `rounded-xl` / `rounded-2xl` for buttons, inputs, or cards — those are Tailwind defaults and look generic. Use the named tokens above. `rounded-full` is reserved for circular elements (avatars, pill badges).

### Button and input constants (`styles.ts`)

`flamerelay/static/js/styles.ts` exports fully-composed class strings. Always import from there instead of constructing button or input classes inline.

```ts
import {
  primaryBtnLg,
  primaryBtnMd,
  primaryBtn, // amber fill — Lg/Md differ in padding; primaryBtn adds w-full
  emberBtnMd, // destructive red fill
  outlineBtnLg,
  outlineBtnMd,
  outlineBtnSm, // border/ghost
  inputClass, // full-width text input / textarea
  labelClass, // form label
  secondaryBtn, // compact inline action (email row buttons etc.)
} from '../styles';
```

Sizing guide:

- **Lg** (`px-[22px] py-[9px]`) — primary page actions (submit, hero CTA)
- **Md** (`px-[18px] py-[7px]`) — secondary page actions (settings saves, nav buttons)
- **Sm** (`px-3 py-[5px]`) — compact inline actions inside forms or tables

### Button conventions

All buttons share a lift-on-hover pattern (`hover:-translate-y-px active:translate-y-0`) rather than the default opacity fade (`hover:opacity-90`). The `disabled:pointer-events-none` class is included in every button base so the lift effect does not apply to disabled buttons.

- Use `tracking-wide` on button text (it is baked into the `btnBase` in `styles.ts`).
- Avoid `px-4 py-2`, `px-6 py-3`, or any other grid-aligned padding on buttons — the off-grid arbitrary values are intentional.
- The `primaryBtn` export (full-width) is for auth-page submit buttons only. Everywhere else use `primaryBtnLg` or `primaryBtnMd`.

## Maps

Map pages use **MapLibre GL JS** via **react-map-gl** (`react-map-gl/maplibre`). Tiles are served by MapTiler — the API key comes from `useConfig()`:

```tsx
const { maptilerKey } = useConfig();
```

Style URL pattern:

```
https://api.maptiler.com/maps/dataviz/style.json?key=${maptilerKey}
```

Pages with maps: `Unit.tsx` (travel history) and `CheckinForm.tsx` (location picker). Do not import from `react-leaflet` or `leaflet` — those packages have been removed.

### Deferred map load on Unit pages

`Unit.tsx` does **not** statically import `<UnitMap>` — the maplibre vendor chunk is ~1 MiB uncompressed and would block the QR-landing first paint. Instead the page renders a placeholder, then loads the map module via `import('../components/UnitMap')` inside `requestIdleCallback` (with a 2s `setTimeout` fallback). The component swaps in once the chunk arrives.

Consequence: `preload.py` deliberately omits the `vendor-maplibre` chunk from the Unit-route preload hints. Re-adding it would defeat the defer. If you add another large dep that should follow the same pattern, mirror the state-driven dynamic import in `Unit.tsx` rather than wrapping in `React.lazy()` (which fires the import on first render, too eager for this case).

## Check-in images

Each `CheckIn` has up to 5 images stored in a related `CheckInImage` model. The API returns them as `images: Array<{ id: number; image: string; order: number }>` nested inside every check-in response.

### ImageCarousel (`Unit.tsx`)

`ImageCarousel` is a file-local component in `Unit.tsx`. It uses **native CSS scroll-snap** — no manual touch-delta detection:

- The scroll track is `flex snap-x snap-mandatory overflow-x-auto [&::-webkit-scrollbar]:hidden` with `style={{ scrollbarWidth: 'none' }}`.
- Each slide is `flex-shrink-0 w-full h-full snap-start`.
- `onScroll` updates the active index via `Math.round(scrollLeft / clientWidth)`.
- Desktop prev/next buttons and dots call `trackRef.current.scrollTo({ left: i * clientWidth, behavior: 'smooth' })`.
- The parent container uses `aspect-square overflow-hidden` so all images — portrait or landscape — occupy the same fixed area and the dot indicators always sit at a known position.
- A single image renders the same way but with no chrome (no badge, no buttons, no dots).

### CheckinForm multi-image upload

`CheckinForm.tsx` accepts `initialData.images: Array<{ id: number; image: string }>` for edit mode.

- New files are stored in `imageFiles: File[]` state; each is converted to WebP via `canvas.toBlob` before being appended.
- SVGs are rejected client-side (type check + restricted `accept` attribute) because Pillow cannot process them and would return a 500 HTML response instead of a JSON error.
- On submit: `imageFiles.forEach(f => data.append('images', f))`. In edit mode, `data.append('remove_image_ids', JSON.stringify(removedImageIds))` is also sent.
- The file input is hidden once `CHECKIN_MAX_IMAGES` (5) is reached.

## Auth flow (Login.tsx)

Auth is **passwordless**. `Login.tsx` is the single entry point for all users — new and returning.

Steps: `email → code → (name?) → app`  **or** `passkey → (name?) → app`

1. **`email`** (default): user enters email and clicks "Continue with email". Calls `POST /api/auth/code/request/` via `apiFetch` (our own endpoint). Always returns the same response regardless of whether the account exists — prevents enumeration. On success → `code`.
2. **`code`**: user enters the OTP from their email. Calls `POST /_allauth/browser/v1/auth/code/confirm`. On success → checks `/api/account/` for empty `name`.
3. **`name`** (new users only): if `me.name` is blank, shown inline before redirect. PATCHes `/api/account/` to save the name. Calls `refresh()` then navigates.
4. **`mfa`**: if the `mfa_authenticate` pending flow is present in the 401 response after code confirm.

**Passkey path**: a "Sign in with a passkey" button appears on the `email` step (above social providers, below the email form) when `browserSupportsWebAuthn()` is true. Clicking it calls `getPasskeyLoginOptions()` then `startAuthentication()` then `passkeyLogin()` — all from `allauthApi.ts` / `@simplewebauthn/browser`. On success it follows the same `handleAuthResponse → checkNameThenRedirect` path as the code flow.

**Conditional mediation** (autofill): on mount, `Login.tsx` also starts a background `startAuthentication({ useBrowserAutofill: true })` ceremony so browsers that support it can surface the passkey in the email field's autofill dropdown. `WebAuthnAbortService.cancelCeremony()` is called before the email form is submitted to avoid competing ceremonies.

On mount, `Login.tsx` also handles:

- `?code=<value>` in the URL — auto-submits the magic link code from the login email.
- `is_authenticated` session — redirects directly to the app (e.g. after OAuth callback lands back at `/accounts/login/`).
- `login_by_code` pending flow — restores the code-entry step if the user navigated away mid-flow.

After successful login (any path), the default redirect is `/profile/` (not `/`). A `?next=` param overrides this.

Social providers appear on the `email` step via `<SocialProviders callbackUrl="/accounts/login/" />`. After OAuth, the provider redirects to `/accounts/google/login/callback/` (handled server-side by allauth), which then redirects back to `/accounts/login/`. The `useEffect` session check handles routing from there.

## Signup.tsx (name confirmation only)

`Signup.tsx` handles one case: an authenticated user who needs to set or update their display name. On mount it calls `getSession()`:

- If authenticated → fetches `/api/account/`, pre-fills the name field, shows the form.
- If not authenticated → `navigate('/accounts/login/')` immediately.

Submit PATCHes `/api/account/`, calls `refresh()`, then navigates to `redirectUrl`.

New social users reach here when `me.name` is blank after OAuth — `checkNameThenRedirect()` in Login.tsx detects the blank name and navigates to `/accounts/signup/`. Email-code new users go through the inline `name` step in Login.tsx instead.

## Allauth headless API

API wrappers live in `flamerelay/static/js/lib/allauthApi.ts` and call `/_allauth/browser/v1/`. Use `X-CSRFToken` (same cookie pattern as `apiFetch`). Logout is handled inline in `Navbar.tsx` via `DELETE /auth/session` — after `logout()` resolves, `refresh()` is called to clear the auth context before navigating.

**Exception**: `requestLoginCode()` in `allauthApi.ts` calls `POST /api/auth/code/request/` via the top-level-imported `getCsrfToken`, not a dynamic import. This is intentional — it's our own endpoint that handles account creation + allauth code initiation in one step.

MFA management (TOTP setup/teardown, recovery codes) is handled inline in `UserSettings.tsx` via the authenticators headless API (`/account/authenticators/…`). No separate MFA pages exist — `HEADLESS_ONLY = True` removed all Bootstrap views.

Passkey management is in `UserSettings/PasskeySection.tsx`.

### WebAuthn / Passkeys API paths

The allauth WebAuthn API has several non-obvious shapes. The wrappers in `allauthApi.ts` hide this, but document it here for future debugging:

**Passkey login** (unauthenticated):
- `GET /auth/webauthn/login` → `{ data: { request_options: { publicKey: { … } } } }` — get challenge
- `POST /auth/webauthn/login` → send `{ credential: { … } }` (wrapped, not top-level fields)

**WebAuthn MFA** (second factor after email/password):
- `GET /auth/webauthn/authenticate` → `{ data: { request_options: { publicKey: { … } } } }` — path is `/auth/webauthn/authenticate`, NOT `/auth/2fa/webauthn/authenticate`
- `POST /auth/webauthn/authenticate` → send `{ credential: { … } }`

**Passkey management** (authenticated, in Settings):
- `GET /account/authenticators` → list all authenticators; filter by `type === 'webauthn'` on the frontend — do NOT use `GET /account/authenticators/webauthn` (that begins a registration ceremony, not a list)
- `GET /account/authenticators/webauthn` → begin registration: `{ data: { creation_options: { publicKey: { … } } } }`
- `POST /account/authenticators/webauthn` → complete registration: send `{ credential: { … }, name: "…" }`
- `DELETE /account/authenticators/webauthn` → delete: send `{ authenticators: [id] }` (array, not `{ id }`)

The `publicKey` wrapper comes from py-webauthn's `register_begin` / `authenticate_begin` response format. Always unwrap `.publicKey` before passing options to `startRegistration` / `startAuthentication` from `@simplewebauthn/browser`.

**Backend settings** (for reference when debugging):
- `MFA_SUPPORTED_TYPES = ["totp", "recovery_codes", "webauthn"]` — in `config/settings/base.py`
- `MFA_PASSKEY_LOGIN_ENABLED = True` — enables the `/auth/webauthn/login` endpoint
- `MFA_ADAPTER = "flamerelay.users.adapters.MFAAdapter"` — sets the RP name to "LitRoute"; the RP ID is derived automatically from `request.get_host()` (so it's `localhost` in dev and `flamerelay.com` in prod — do not hardcode it)
- `MFA_WEBAUTHN_ALLOW_INSECURE_ORIGIN = True` — in `config/settings/local.py` only, required for localhost dev
- Safari requires HTTPS even on localhost for WebAuthn; use Firefox or Chrome for local development
