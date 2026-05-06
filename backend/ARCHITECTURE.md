# Backend Architecture

Read before editing `backend/models.py`, signals, or anything that touches authentication, permissions, or storage cleanup.

## Custom User model

Single `name` field instead of `first_name`/`last_name` (`flamerelay/users/models.py`). `name` is the public display name everywhere — checkins, profile page, avatar initials. **Never add first/last name fields.**

No public user profiles. `/profile/` shows the authenticated user's own profile only — there are no per-user public profile URLs. `UserDetailView` and `users:detail` do not exist; `User.get_absolute_url()` returns `"/profile/"`. Do not add a `<username>/` lookup route.

## Passwordless auth

`ACCOUNT_EMAIL_VERIFICATION = "none"`, `ACCOUNT_SIGNUP_FIELDS = ["email*"]`. No passwords, no email verification step. Users authenticate via:

1. Magic OTP code sent to email (allauth's code flow)
2. Social OAuth (Google, etc.)
3. Registered WebAuthn passkey

All paths land at `/accounts/login/`. The passkey flow uses `@simplewebauthn/browser` on the frontend and `allauth.mfa.webauthn` / `webauthn>=2.0` (py-webauthn) on the backend. See `flamerelay/templates/FRONTEND.md → WebAuthn / Passkeys API paths` for endpoint shapes.

`/accounts/signup/` renders only for **authenticated** users confirming or updating their display name. Unauthenticated visitors are redirected to login. New social users are sent here by `checkNameThenRedirect()` in `Login.tsx` when `me.name` is blank after OAuth.

## AllAuth controls admin login

Admin login is routed through allauth's workflow — do not add a separate Django admin login form. `HEADLESS_ONLY = True` removed all the Bootstrap pages; MFA and passkey management are inline in `UserSettings.tsx` / `PasskeySection.tsx`.

OpenAPI docs (`/api/schema/`, `/api/docs/`) are admin-only in production.

## Transactions and async

- `ATOMIC_REQUESTS = True`: every request is wrapped in a DB transaction.
- Storage operations are non-transactional — keep them outside `transaction.atomic` blocks; log failures but never raise.
- Celery Beat uses the **DB scheduler** (`django-celery-beat`). Manage periodic tasks via Django admin, not code.

CORS is restricted to `/api/*` paths only.

## CheckInImage and storage cleanup

`CheckIn` has **no direct image field**. Images live in `CheckInImage` (FK `checkin`, `related_name="images"`, ordered by `order`). Image files are stored via `ResizedImageField` (max 1024×1024, forced WEBP, quality 85).

A `post_delete` signal on `CheckInImage` calls `default_storage.delete()` so files are cleaned up whenever a row is removed — whether from the API, admin, or `anonymize_user`. The signal pattern is in `backend/models.py` alongside the other `@receiver` functions.

Email templates use `instance.images.first` to show the lead image.

**Storage file cleanup pattern:** use a `post_delete` signal rather than overriding `delete()` or handling cleanup in views. This ensures cleanup happens regardless of how the row is removed.

## Permissions

Global default is `IsAuthenticatedOrReadOnly`.

- **`UnitViewSet` is public read**: it uses `IsAuthenticatedOrReadOnly` so unauthenticated GET requests are allowed. All user-specific fields (`is_subscribed`, `can_check_in`) return safe defaults for anonymous users.
- **`StatsView`** is explicitly set to `AllowAny` — without that override it would inherit `IsAuthenticatedOrReadOnly` and reject anonymous GETs.
