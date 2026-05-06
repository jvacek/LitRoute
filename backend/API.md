# REST API

All endpoints are under `/api/`. The **live Swagger UI at `/api/docs/`** is the authoritative reference (admin-only in production; open in local dev).

The router is in `config/api_router.py`. All routes are registered as manual `path()` entries — the DRF router has no registered viewsets, so the browsable API root (`/api/`) is empty. `/api/docs/` is the only complete reference.

## Notable endpoints

- `POST /api/auth/code/request/` — unified sign-in / sign-up. Creates the account if it doesn't exist, then triggers allauth's magic-code flow. Always returns `{"detail": "Code sent."}` regardless of whether the email was registered (anti-enumeration). Rate-limited via allauth's `ratelimit.consume()`. See `flamerelay/users/api/views.py::RequestCodeView`.
- `GET /api/account/` — returns `{ username, name, is_superuser, … }` for the authenticated user. Used by `AuthContext` on every page load. Also supports `PATCH` (update name), `PUT`, `DELETE` (account anonymisation). See `flamerelay/users/api/views.py::AccountView`.
- `GET /api/account/subscriptions/` — units the authenticated user is subscribed to.
- `DELETE /api/account/social-accounts/` — disconnect a connected social OAuth account.
- `GET /api/config/` — public, returns `{ maptilerKey, allowRegistration }`. Fetched once per session by `useConfig()` and cached in a module-level promise.

## Conventions

- **Constants:** edit/delete grace periods are in `config/constants.py` (`CHECKIN_EDIT_GRACE_PERIOD_HOURS`, `CHECKIN_DELETE_GRACE_PERIOD_HOURS`). All magic numbers go there — never inline.
- **drf-spectacular schemas:** annotate `SerializerMethodField` methods with Python return types so the generated schema is correct.
- **No-body endpoints** (e.g. subscribe/unsubscribe): use `@extend_schema(request=None, responses={204: None, 401: None})`.
- **`created_by_name`** (from `User.name`) appears in CheckIn responses alongside `created_by_username`.

## Multi-image uploads

Image files are sent as repeated `multipart/form-data` fields all named `images` — read on the server with `request.FILES.getlist('images')`. Maximum is `CHECKIN_MAX_IMAGES = 5` (in `config/constants.py`).

On edit, existing images to remove are sent as a single JSON-encoded field `remove_image_ids` (e.g. `"[1, 3]"`). New image files are processed in `perform_create` / `partial_update` in `backend/api/views.py` — Pillow errors are caught and re-raised as `ValidationError` so the client always gets a 400 JSON response rather than a 500 HTML page.
