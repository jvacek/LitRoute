# REST API

All endpoints are under `/api/`. The **live Swagger UI at `/api/docs/`** is the authoritative reference (admin-only in production; open in local dev).

The router is in `config/api_router.py`. All routes are registered as manual `path()` entries — the DRF router has no registered viewsets, so the browsable API root (`/api/`) is empty. `/api/docs/` is the only complete reference.

## Testing

- **Every API endpoint must have at least one test in `backend/tests/api/`**. Cover: happy path, auth requirement, and key error cases. Per-endpoint files (e.g. `test_checkins.py`, `test_location_claim.py`) keep concerns separated.
- Logic-layer tests (model methods, validators, services, signals) live directly in `backend/tests/` — keep them out of the `api/` subtree so the request-vs-logic split stays clean.

## Notable endpoints

- `POST /api/auth/code/request/` — unified sign-in / sign-up. Creates the account if it doesn't exist, then triggers allauth's magic-code flow. Always returns `{"detail": "Code sent."}` regardless of whether the email was registered (anti-enumeration). Rate-limited via allauth's `ratelimit.consume()`. See `flamerelay/users/api/views.py::RequestCodeView`.
- `GET /api/account/` — returns `{ username, name, is_superuser, … }` for the authenticated user. Used by `AuthContext` on every page load. Also supports `PATCH` (update name), `PUT`, `DELETE` (account anonymisation). See `flamerelay/users/api/views.py::AccountView`.
- `GET /api/account/subscriptions/` — units the authenticated user is subscribed to.
- `DELETE /api/account/social-accounts/` — disconnect a connected social OAuth account.
- `GET /api/config/` — public, returns `{ maptilerKey, allowRegistration }`. Fetched once per session by `useConfig()` and cached in a module-level promise.
- `GET /api/games/<id>/leaderboard/` — public. Accepts an optional `?from=<unit-identifier>` query param: every row in the response sets `identifier=null` **except** the row matching `from`. Anti-enumeration — without this, the public endpoint would let anyone scrape every unit slug in a game from one request. The cache stores the canonical (full-identifier) data; the strip runs at the response boundary, so different `from` values do not pollute the shared cache. See `GameLeaderboardView` and `test_identifiers_hidden_without_from_param` / `test_from_filter_does_not_pollute_cache`. Each `individual` row also includes a `journey: [{lng, lat, date, after_end}]` array — chronologically-ordered check-in coordinates used to draw routes on the leaderboard map. `after_end=true` flags points dated after `game.end_time`; the frontend renders these segments faded so the route stays visually continuous.

## Conventions

- **Constants:** edit/delete grace periods are in `config/constants.py` (`CHECKIN_EDIT_GRACE_PERIOD_HOURS`, `CHECKIN_DELETE_GRACE_PERIOD_HOURS`). All magic numbers go there — never inline.
- **drf-spectacular schemas:** annotate `SerializerMethodField` methods with Python return types so the generated schema is correct.
- **No-body endpoints** (e.g. subscribe/unsubscribe): use `@extend_schema(request=None, responses={204: None, 401: None})`.
- **`created_by_name`** (from `User.name`) appears in CheckIn responses alongside `created_by_username`.
- **Anti-enumeration of unit identifiers:** unit slugs are an attack surface — anyone with a slug can hit `/api/units/<slug>/`. The retrieval pattern is by design (the caller already knows the slug from sharing or URL navigation), but **no public endpoint should bulk-list slugs**. New list-style endpoints must either require auth and scope to the caller (like `/api/account/subscriptions/`) or strip identifiers from rows the caller didn't already know about (like the leaderboard's `?from=` mechanic). When in doubt, default to `identifier=null` and require an explicit query param to opt that one row in.

## Multi-image uploads

Image files are sent as repeated `multipart/form-data` fields all named `images` — read on the server with `request.FILES.getlist('images')`. Maximum is `CHECKIN_MAX_IMAGES = 5` (in `config/constants.py`).

On edit, existing images to remove are sent as a single JSON-encoded field `remove_image_ids` (e.g. `"[1, 3]"`). New image files are processed in `perform_create` / `partial_update` in `backend/api/views.py` — Pillow errors are caught and re-raised as `ValidationError` so the client always gets a 400 JSON response rather than a 500 HTML page.
