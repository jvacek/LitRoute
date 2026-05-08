# Backend Testing Conventions

Read before adding or modifying any test under `backend/tests/` or `flamerelay/users/tests/`. The suite is small on purpose — these rules keep it that way.

## Layered structure

```
backend/tests/
  conftest.py             # shared fixtures + constants (single source of truth)
  test_*.py               # LOGIC layer: model methods, services, validators, signals, crypto
  api/
    test_*.py             # REQUEST layer: HTTP via APIClient, status codes, response JSON
flamerelay/users/tests/
  test_*.py               # User-app logic
  api/test_*.py           # User-app HTTP endpoints
```

**One concern per file.** Logic-layer tests assert on Python return values, model state, and side effects. Request-layer tests assert on `response.status_code`, response JSON shape, and HTTP-visible permissions. If a test class mixes the two, split it. Cross-reference between the two layers in module docstrings (e.g. `test_unit_model.py` ↔ `api/test_checkins.py::TestCheckInCreate`).

## Shared fixtures (`backend/tests/conftest.py`)

| Fixture                                                 | What it gives you                                                                                                                                                                                                    |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `client`                                                | Unauthenticated `APIClient`.                                                                                                                                                                                         |
| `user`                                                  | A new `User` (canonical `UserFactory` from `flamerelay/users/tests/factories.py`).                                                                                                                                   |
| `unit`                                                  | A new `Unit` from `UnitFactory`.                                                                                                                                                                                     |
| `auth_client`                                           | `client` already authenticated as `user` via `force_authenticate`.                                                                                                                                                   |
| `make_checkin`                                          | Factory function: `make_checkin(unit, user=None, *, location=LONDON, hours_ago=0, anonymous=False, **kwargs)`. Patches the two Celery email tasks; backdates `date_created` via `update()` to bypass `auto_now_add`. |
| `mute_emails`                                           | Same Celery patch as a no-op fixture for tests that POST to the API (where the model save fires the tasks).                                                                                                          |
| `clear_cache`                                           | Resets `django.core.cache` before and after the test.                                                                                                                                                                |
| `LONDON` / `PARIS` / `LONDON_PAYLOAD` / `PARIS_PAYLOAD` | Constants for geo-tests; import from `backend.tests.conftest`.                                                                                                                                                       |

**Never redefine these fixtures in a test file.** If you find yourself wanting a variant, add it to `conftest.py` or take parameters via a factory fixture (the way `make_checkin` does).

## Factories

`backend/factories.py` (`GameFactory`, `UnitFactory`, `CheckInFactory`) re-exports `UserFactory` from `flamerelay/users/tests/factories.py` — that's the **only** `UserFactory`. Don't add a second one.

Prefer `UnitFactory.create()` over hand-rolled `Unit.objects.create()`. The factory's auto-generated identifier matches the production format (`abc-12`).

## FIRST-U conformance

- **Fast** — no `time.sleep`, no real network. The full suite runs under 10 seconds; keep it that way.
- **Isolated** — every test must work in any order. Use `clear_cache` for any test that reads/writes shared cache keys (leaderboard, journeys, location-claim replay, stats, globe-pins).
- **Repeatable** — no wall-clock dependence beyond `timezone.now()`. Use `make_checkin(..., hours_ago=N)` for grace-period tests, never `freezegun`-style time travel without good reason.
- **Self-validating** — assert specific values, not "didn't crash". Status codes go through `from rest_framework import status` — `assert res.status_code == status.HTTP_201_CREATED`, never `== 201` (avoids `# noqa: PLR2004`).
- **Timely** — write the test alongside the feature, not after.
- **Unique** — if two tests assert the same thing through different framings, delete one.

## Don't test external packages

We do not test:

- Django ORM, signals, template engine, or admin internals.
- DRF's serializer/viewset machinery (we test our serializers' field-level rules and our views' permission rules — not DRF's plumbing).
- drf-spectacular's schema generation (we test access control on `/api/docs/`).
- AllAuth flows (we test our adapter customisations and our endpoints).
- Celery task scheduling (we test that the right task is enqueued via `mock.assert_called_once`, and that task functions do the right thing when invoked directly).

If a test would still pass after Django is replaced with FastAPI, it's not testing our code. Delete it.

## Patterns to copy

- **Anti-enumeration**: `backend/tests/api/test_leaderboard.py::TestLeaderboardAntiEnumeration` — assert that without/with `?from=` only the matching row exposes its identifier.
- **Token replay**: `backend/tests/test_location_token.py::TestVerifyLocationClaim::test_replay_raises` — first verify succeeds, second raises.
- **Grace-period boundary**: pass `hours_ago=GRACE_PERIOD_HOURS + 1` to `make_checkin` rather than monkeypatching `date_created` inline.
- **Signal-driven cache invalidation** (`test_caching.py`): use `django.test.TestCase` plus `captureOnCommitCallbacks(execute=True)` because invalidations are deferred via `transaction.on_commit`.

## Anti-patterns

- ❌ Inline magic status codes (`== 201 # noqa: PLR2004`). Use `status.HTTP_201_CREATED`.
- ❌ A local `make_checkin`/`make_anon_checkin` helper. The shared fixture already covers both.
- ❌ Patching `CheckIn.images` with a `MagicMock`. If you need an image, create a real `CheckInImage` row.
- ❌ A test whose only assertion is "the page returns 200" or "the schema validates" — that's framework coverage.
- ❌ Threading-based concurrency tests beyond the existing `TestCachedWithLock::test_single_flight_under_concurrency`. Distributed-lock behaviour is the only thing we have to verify this way; resist adding more.

## Running tests

See CLAUDE.md → Running Tests. `just test` runs the full suite; `just test backend/tests/api/` for the request layer; `just test -k <name>` for a single test.
