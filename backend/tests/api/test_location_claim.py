"""POST /api/location-claim/ and the GPS-enforced flavor of POST /api/units/<id>/checkins/."""

from __future__ import annotations

import hashlib
import io

import pytest
from django.core.cache import cache
from PIL import Image
from rest_framework import status

from backend.factories import UnitFactory
from backend.location_token import issue_location_claim
from backend.models import Game
from backend.tests.conftest import LONDON_PAYLOAD
from flamerelay.users.tests.factories import UserFactory


# Replay-prevention reads/writes the cache; reset around each test.
@pytest.fixture(autouse=True)
def _isolate_cache(clear_cache):
    pass


@pytest.fixture
def gps_unit(db):
    game = Game.objects.create(mode=Game.Modes.RACE, name="GPS Race")
    return UnitFactory.create(game=game)


def _claim(user_id, unit, lat=51.5074, lng=-0.1278, accuracy=10.0):
    return issue_location_claim(lat, lng, accuracy, user_id, unit_identifier=unit.identifier)


# ── /api/location-claim/ ───────────────────────────────────────────────────────


class TestLocationClaimView:
    BODY = {"lat": 51.5074, "lng": -0.1278, "accuracy": 10.0}

    def test_anon_returns_token(self, client, unit):
        # Anonymous claims work so GPS-enforced anonymous check-ins are possible.
        res = client.post(
            "/api/location-claim/",
            {**self.BODY, "unit_identifier": unit.identifier},
            format="json",
        )
        assert res.status_code == status.HTTP_200_OK
        assert isinstance(res.json().get("token"), str)

    def test_authenticated_returns_token(self, auth_client, unit):
        res = auth_client.post(
            "/api/location-claim/",
            {**self.BODY, "unit_identifier": unit.identifier},
            format="json",
        )
        assert res.status_code == status.HTTP_200_OK
        assert isinstance(res.json().get("token"), str)

    def test_missing_fields_returns_400(self, auth_client):
        res = auth_client.post("/api/location-claim/", {}, format="json")
        assert res.status_code == status.HTTP_400_BAD_REQUEST

    def test_unknown_unit_returns_404(self, auth_client, db):
        res = auth_client.post(
            "/api/location-claim/",
            {**self.BODY, "unit_identifier": "no-such-unit"},
            format="json",
        )
        assert res.status_code == status.HTTP_404_NOT_FOUND

    def test_accuracy_too_low_returns_400(self, auth_client, unit):
        res = auth_client.post(
            "/api/location-claim/",
            {"lat": 51.5, "lng": -0.1, "accuracy": 500.0, "unit_identifier": unit.identifier},
            format="json",
        )
        assert res.status_code == status.HTTP_400_BAD_REQUEST

    def test_out_of_range_coords_returns_400(self, auth_client, unit):
        res = auth_client.post(
            "/api/location-claim/",
            {"lat": 999.0, "lng": -0.1, "accuracy": 10.0, "unit_identifier": unit.identifier},
            format="json",
        )
        assert res.status_code == status.HTTP_400_BAD_REQUEST

    def test_rate_limit_returns_429(self, auth_client, unit, settings):
        settings.ACCOUNT_RATE_LIMITS = {**settings.ACCOUNT_RATE_LIMITS, "location_claim": "2/m"}
        body = {**self.BODY, "unit_identifier": unit.identifier}
        for _ in range(2):
            assert auth_client.post("/api/location-claim/", body, format="json").status_code == status.HTTP_200_OK
        res = auth_client.post("/api/location-claim/", body, format="json")
        assert res.status_code == status.HTTP_429_TOO_MANY_REQUESTS


# ── GPS-enforced check-in (authenticated) ──────────────────────────────────────


class TestCheckInGpsEnforcedAuth:
    def test_missing_token_returns_400(self, auth_client, gps_unit, mute_emails):
        res = auth_client.post(
            f"/api/units/{gps_unit.identifier}/checkins/",
            {"location": LONDON_PAYLOAD, "place": "London"},
            format="json",
        )
        assert res.status_code == status.HTTP_400_BAD_REQUEST
        assert "location_token" in res.json()

    def test_valid_token_creates_checkin(self, auth_client, gps_unit, user, mute_emails):
        token = _claim(user.id, gps_unit)
        res = auth_client.post(
            f"/api/units/{gps_unit.identifier}/checkins/",
            {"location": LONDON_PAYLOAD, "location_token": token, "place": "London"},
            format="json",
        )
        assert res.status_code == status.HTTP_201_CREATED

    def test_token_wrong_user_returns_400(self, auth_client, gps_unit, mute_emails):
        token = _claim(UserFactory.create().id, gps_unit)
        res = auth_client.post(
            f"/api/units/{gps_unit.identifier}/checkins/",
            {"location": LONDON_PAYLOAD, "location_token": token, "place": "London"},
            format="json",
        )
        assert res.status_code == status.HTTP_400_BAD_REQUEST
        assert "different user" in str(res.json())

    def test_token_wrong_unit_returns_400(self, auth_client, gps_unit, user, mute_emails):
        other_game = Game.objects.create(mode=Game.Modes.RACE, name="Other GPS Race")
        other_unit = UnitFactory.create(game=other_game)
        token = _claim(user.id, other_unit)
        res = auth_client.post(
            f"/api/units/{gps_unit.identifier}/checkins/",
            {"location": LONDON_PAYLOAD, "location_token": token, "place": "London"},
            format="json",
        )
        assert res.status_code == status.HTTP_400_BAD_REQUEST
        assert "different unit" in str(res.json())

    def test_replay_returns_400(self, auth_client, gps_unit, user, mute_emails):
        token = _claim(user.id, gps_unit)
        body = {"location": LONDON_PAYLOAD, "location_token": token, "place": "London"}
        first = auth_client.post(f"/api/units/{gps_unit.identifier}/checkins/", body, format="json")
        second = auth_client.post(f"/api/units/{gps_unit.identifier}/checkins/", body, format="json")
        assert first.status_code == status.HTTP_201_CREATED
        assert second.status_code == status.HTTP_400_BAD_REQUEST
        assert "already used" in str(second.json())

    def test_location_beyond_drift_returns_400(self, auth_client, gps_unit, user, mute_emails):
        token = _claim(user.id, gps_unit)
        res = auth_client.post(
            f"/api/units/{gps_unit.identifier}/checkins/",
            # ~666 m north — beyond the default 500 m drift
            {
                "location": {"type": "Point", "coordinates": [-0.1278, 51.5134]},
                "location_token": token,
                "place": "London",
            },
            format="json",
        )
        assert res.status_code == status.HTTP_400_BAD_REQUEST

    def test_missing_place_returns_400(self, auth_client, gps_unit, user, mute_emails):
        token = _claim(user.id, gps_unit)
        res = auth_client.post(
            f"/api/units/{gps_unit.identifier}/checkins/",
            {"location": LONDON_PAYLOAD, "location_token": token},
            format="json",
        )
        assert res.status_code == status.HTTP_400_BAD_REQUEST
        assert "place" in res.json()

    def test_token_survives_required_field_failure(self, auth_client, gps_unit, user, mute_emails):
        # Required-field validation must run before token verification, so a
        # 400 on missing place doesn't consume the single-use GPS claim.
        token = _claim(user.id, gps_unit)
        first = auth_client.post(
            f"/api/units/{gps_unit.identifier}/checkins/",
            {"location": LONDON_PAYLOAD, "location_token": token},
            format="json",
        )
        second = auth_client.post(
            f"/api/units/{gps_unit.identifier}/checkins/",
            {"location": LONDON_PAYLOAD, "location_token": token, "place": "London"},
            format="json",
        )
        assert first.status_code == status.HTTP_400_BAD_REQUEST
        assert second.status_code == status.HTTP_201_CREATED

    def test_junk_place_rejected(self, auth_client, gps_unit, user, mute_emails):
        # Punctuation-only place doesn't satisfy the word-character minimum.
        token = _claim(user.id, gps_unit)
        res = auth_client.post(
            f"/api/units/{gps_unit.identifier}/checkins/",
            {"location": LONDON_PAYLOAD, "location_token": token, "place": "..."},
            format="json",
        )
        assert res.status_code == status.HTTP_400_BAD_REQUEST
        assert "place" in res.json()

    def test_unicode_place_accepted(self, auth_client, gps_unit, user, mute_emails):
        # Mirrors the frontend regex /[\p{L}\p{N}]/gu — non-ASCII letters count.
        token = _claim(user.id, gps_unit)
        res = auth_client.post(
            f"/api/units/{gps_unit.identifier}/checkins/",
            {"location": LONDON_PAYLOAD, "location_token": token, "place": "東京都"},
            format="json",
        )
        assert res.status_code == status.HTTP_201_CREATED


# ── GPS-enforced check-in (anonymous) ──────────────────────────────────────────


class TestCheckInGpsEnforcedAnon:
    def test_missing_token_returns_400(self, client, gps_unit):
        res = client.post(
            f"/api/units/{gps_unit.identifier}/checkins/",
            {"location": LONDON_PAYLOAD, "place": "London", "anonymous_name": "Alice"},
            format="json",
        )
        assert res.status_code == status.HTTP_400_BAD_REQUEST
        assert "location_token" in res.json()

    def test_valid_token_creates_checkin(self, client, gps_unit, mute_emails):
        token = _claim(None, gps_unit)
        res = client.post(
            f"/api/units/{gps_unit.identifier}/checkins/",
            {
                "location": LONDON_PAYLOAD,
                "location_token": token,
                "place": "London",
                "anonymous_name": "Alice",
            },
            format="json",
        )
        assert res.status_code == status.HTTP_201_CREATED

    def test_authed_token_rejected_for_anon_request(self, client, gps_unit, user, mute_emails):
        # A token minted for an authenticated user must not be accepted anonymously.
        token = _claim(user.id, gps_unit)
        res = client.post(
            f"/api/units/{gps_unit.identifier}/checkins/",
            {"location": LONDON_PAYLOAD, "location_token": token},
            format="json",
        )
        assert res.status_code == status.HTTP_400_BAD_REQUEST

    def test_missing_anonymous_name_returns_400(self, client, gps_unit):
        token = _claim(None, gps_unit)
        res = client.post(
            f"/api/units/{gps_unit.identifier}/checkins/",
            {"location": LONDON_PAYLOAD, "location_token": token, "place": "London"},
            format="json",
        )
        assert res.status_code == status.HTTP_400_BAD_REQUEST
        assert "anonymous_name" in res.json()

    def test_junk_anonymous_name_rejected(self, client, gps_unit):
        token = _claim(None, gps_unit)
        res = client.post(
            f"/api/units/{gps_unit.identifier}/checkins/",
            {
                "location": LONDON_PAYLOAD,
                "location_token": token,
                "place": "London",
                "anonymous_name": "ab",
            },
            format="json",
        )
        assert res.status_code == status.HTTP_400_BAD_REQUEST
        assert "anonymous_name" in res.json()


# ── Token consumption invariants ───────────────────────────────────────────────


class TestNonGpsUnitDoesNotRequirePlace:
    def test_plain_unit_accepts_minimal_payload(self, auth_client, db, mute_emails):
        plain_unit = UnitFactory.create()
        res = auth_client.post(
            f"/api/units/{plain_unit.identifier}/checkins/",
            {"location": LONDON_PAYLOAD},
            format="json",
        )
        assert res.status_code == status.HTTP_201_CREATED


class TestTokenConsumption:
    @staticmethod
    def _used_key(token):
        return f"location-claim-used:{hashlib.sha256(token.encode()).hexdigest()[:32]}"

    def test_token_not_consumed_on_permission_denied(self, auth_client, user, db, mute_emails):
        # admin_only_checkin denies a non-admin user *before* any single-use token
        # is consumed — so the user can retry once the unit is reopened without
        # having to recapture GPS.
        game = Game.objects.create(mode=Game.Modes.RACE, name="Locked GPS Race")
        locked_unit = UnitFactory.create(game=game, admin_only_checkin=True)
        token = _claim(user.id, locked_unit)
        res = auth_client.post(
            f"/api/units/{locked_unit.identifier}/checkins/",
            {"location": LONDON_PAYLOAD, "location_token": token, "place": "London"},
            format="json",
        )
        assert res.status_code == status.HTTP_403_FORBIDDEN
        assert cache.get(self._used_key(token)) is None

    def test_token_not_consumed_on_image_count_violation(self, auth_client, gps_unit, user, mute_emails):
        # Image-count violation must be detected *before* the GPS token is consumed.
        token = _claim(user.id, gps_unit)

        def make_jpeg(name: str):
            buf = io.BytesIO()
            Image.new("RGB", (4, 4), color=(255, 0, 0)).save(buf, format="JPEG")
            buf.seek(0)
            buf.name = name
            return buf

        res = auth_client.post(
            f"/api/units/{gps_unit.identifier}/checkins/",
            {
                "location": str(LONDON_PAYLOAD).replace("'", '"'),
                "location_token": token,
                "place": "London",
                "images": [make_jpeg(f"img-{i}.jpg") for i in range(6)],
            },
            format="multipart",
        )
        assert res.status_code == status.HTTP_400_BAD_REQUEST
        assert "images" in res.json()
        assert cache.get(self._used_key(token)) is None


# ── Distance game: time limit is informational only ────────────────────────────


class TestDistanceGameTimeLimit:
    def test_checkin_not_blocked_after_distance_time_limit(self, client, db, make_checkin, mute_emails):
        """Once the Distance game time limit elapses, the lighter is out of the
        running but check-ins are NOT blocked — the journey continues."""
        from backend.factories import GameFactory  # noqa: PLC0415

        game = GameFactory.create(mode=Game.Modes.DISTANCE, allowed_time=1)  # 1 hour
        unit = UnitFactory.create(game=game)
        # First check-in well past the allowed_time.
        make_checkin(unit, UserFactory.create(), hours_ago=10)

        next_user = UserFactory.create()
        token = issue_location_claim(48.8566, 2.3522, 10.0, next_user.id, unit_identifier=unit.identifier)
        client.force_authenticate(user=next_user)
        res = client.post(
            f"/api/units/{unit.identifier}/checkins/",
            {
                "location": {"type": "Point", "coordinates": [2.3522, 48.8566]},
                "location_token": token,
                "place": "Paris",
            },
            format="json",
        )
        assert res.status_code == status.HTTP_201_CREATED
