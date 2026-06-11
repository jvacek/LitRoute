# Auth & Passkeys

LitRoute is **passwordless**: magic OTP + social OAuth + WebAuthn passkeys. No password forms, no email verification step (`ACCOUNT_EMAIL_VERIFICATION = "none"`).

Read this before touching `Login.tsx`, `Signup.tsx`, `lib/allauthApi.ts`, or the passkey UI in `UserSettings/`.

## Login.tsx — single entry point

`pages/Login.tsx` handles new **and** returning users. Steps: `email → code → (name?) → app`. Passkey users skip the code step via autofill.

1. **`email`** (default) — user enters email and clicks "Continue with email". `POST /api/auth/code/request/` via `apiFetch` (our own endpoint). Always returns the same response regardless of whether the account exists — prevents enumeration. On success → `code`.
2. **`code`** — user enters OTP from email. `POST /_allauth/browser/v1/auth/code/confirm`. On success → checks `/api/account/` for empty `name`.
3. **`name`** (new users only) — if `me.name` is blank, shown inline before redirect. PATCHes `/api/account/`, calls `refresh()`, navigates.
4. **`mfa`** — if the `mfa_authenticate` pending flow is present in the 401 after code confirm.

### Passkey path (conditional mediation / autofill)

There's no dedicated passkey button. The email field has `autoComplete="username webauthn"`, and on mount `Login.tsx` starts a background `startAuthentication({ useBrowserAutofill: true })` ceremony (gated by `PublicKeyCredential.isConditionalMediationAvailable()` so non-passkey browsers don't pay the `@simplewebauthn` import cost). Browsers that support it surface the user's passkey in the email field's autofill chip; selecting it calls `passkeyLogin()` and follows the same `handleAuthResponse → checkNameThenRedirect` path as the code flow. `WebAuthnAbortService.cancelCeremony()` is called before the email form is submitted to avoid competing ceremonies. Browsers without conditional mediation simply fall through to the email-code flow.

### On-mount behaviour

`Login.tsx` also handles:

- `?code=<value>` in the URL — auto-submits the magic link code from the login email.
- `is_authenticated` session — redirects directly to the app (e.g. after OAuth callback lands back at `/accounts/login/`).
- `login_by_code` pending flow — restores the code-entry step if the user navigated away mid-flow.

After any successful login, the default redirect is `/profile/` (not `/`). A `?next=` param overrides this.

### Social providers

`<SocialProviders callbackUrl="/accounts/login/" />` renders on the `email` step. After OAuth, the provider redirects to `/accounts/google/login/callback/` (handled server-side by allauth), which redirects back to `/accounts/login/`. The on-mount session check handles routing from there.

## Signup.tsx — name confirmation only

`pages/Signup.tsx` exists for one case: an authenticated user who needs to set or update their display name. On mount it calls `getSession()`:

- If authenticated → fetches `/api/account/`, pre-fills the name field, shows the form.
- If not authenticated → `navigate('/accounts/login/')` immediately.

Submit PATCHes `/api/account/`, calls `refresh()`, navigates to `redirectUrl`.

New social users reach here when `me.name` is blank after OAuth — `checkNameThenRedirect()` in `Login.tsx` detects this and navigates to `/accounts/signup/`. Email-code new users go through the inline `name` step in `Login.tsx` instead.

## Allauth headless API (`lib/allauthApi.ts`)

Wrappers call `/_allauth/browser/v1/` and inject `X-CSRFToken` (same cookie pattern as `apiFetch`). Logout is handled inline in `Navbar.tsx` via `DELETE /auth/session` — after `logout()` resolves, `refresh()` from `useAuth()` is called before navigating.

**Exception:** `requestLoginCode()` calls `POST /api/auth/code/request/` (our own endpoint that combines account creation + allauth code initiation in one step) via the top-level-imported `getCsrfToken`, not a dynamic import. Keep that wired this way.

MFA management (TOTP setup/teardown, recovery codes) is handled inline in `pages/UserSettings/` via the authenticators headless API (`/account/authenticators/…`). No separate MFA pages exist — `HEADLESS_ONLY = True` removed all Bootstrap views.

Passkey management lives in `pages/UserSettings/PasskeySection.tsx`.

## WebAuthn / Passkeys API paths

The allauth WebAuthn API has several non-obvious shapes. The wrappers in `allauthApi.ts` hide this, but document it here for debugging.

**Passkey login** (unauthenticated):

- `GET /auth/webauthn/login` → `{ data: { request_options: { publicKey: { … } } } }` — get challenge
- `POST /auth/webauthn/login` → send `{ credential: { … } }` (wrapped, not top-level fields)

**WebAuthn MFA** (second factor after email/password):

- `GET /auth/webauthn/authenticate` → `{ data: { request_options: { publicKey: { … } } } }` — path is `/auth/webauthn/authenticate`, **NOT** `/auth/2fa/webauthn/authenticate`
- `POST /auth/webauthn/authenticate` → send `{ credential: { … } }`

**Passkey management** (authenticated, in Settings):

- `GET /account/authenticators` → list all authenticators; filter by `type === 'webauthn'` on the frontend — do **NOT** use `GET /account/authenticators/webauthn` (that begins a registration ceremony, not a list)
- `GET /account/authenticators/webauthn` → begin registration: `{ data: { creation_options: { publicKey: { … } } } }`
- `POST /account/authenticators/webauthn` → complete registration: send `{ credential: { … }, name: "…" }`
- `DELETE /account/authenticators/webauthn` → delete: send `{ authenticators: [id] }` (array, not `{ id }`)

The `publicKey` wrapper comes from py-webauthn's `register_begin` / `authenticate_begin` response format. Always unwrap `.publicKey` before passing options to `startRegistration` / `startAuthentication` from `@simplewebauthn/browser`.

### Backend settings (for debugging)

- `MFA_SUPPORTED_TYPES = ["totp", "recovery_codes", "webauthn"]` — `config/settings/base.py`
- `MFA_PASSKEY_LOGIN_ENABLED = True` — enables the `/auth/webauthn/login` endpoint
- `MFA_ADAPTER = "flamerelay.users.adapters.MFAAdapter"` — sets the RP name to "LitRoute"; the RP ID is derived automatically from `request.get_host()` (so it's `localhost` in dev and `litroute.com` in prod — do not hardcode it)
- `MFA_WEBAUTHN_ALLOW_INSECURE_ORIGIN = True` — `config/settings/local.py` only, required for localhost dev
- Safari requires HTTPS even on localhost for WebAuthn; use Firefox or Chrome for local development

### Passkeys don't cross RP IDs

A passkey registered against prod (`litroute.com`) will not appear in autofill on `localhost`, `127.0.0.1`, or a `*.ts.net` Tailscale URL — the browser refuses to surface a credential whose RP ID isn't a registrable suffix of the current origin. This is a WebAuthn invariant, not a config knob. Two ways to work around it for local dev:

1. **Register a separate dev passkey** on `localhost` (or your tailnet host) the first time you need one — `MFA_WEBAUTHN_ALLOW_INSECURE_ORIGIN = True` already permits this on plain HTTP. Recommended for everyday work.
2. **Use a `litroute.com` loopback subdomain** if you genuinely need the prod credential locally: add `127.0.0.1 dev.litroute.com` to `/etc/hosts`, serve Django over HTTPS with a cert valid for that name, and the browser will treat the RP ID `litroute.com` as a match. Fiddly — only reach for it when debugging RP-ID-specific issues.
