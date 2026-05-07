from __future__ import annotations

from datetime import timedelta
from unittest.mock import patch

import pytest
from django.contrib.gis.geos import Point
from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APIClient

from backend.factories import GameFactory, UnitFactory
from backend.location_token import issue_location_claim
from backend.models import CheckIn, Game
from config.constants import CHECKIN_DELETE_GRACE_PERIOD_HOURS, CHECKIN_EDIT_GRACE_PERIOD_HOURS, STATS_CACHE_KEY
from flamerelay.users.tests.factories import UserFactory

LONDON = Point(-0.1278, 51.5074)
PARIS = Point(2.3522, 48.8566)


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture
def user(db):
    return UserFactory.create()


@pytest.fixture
def unit(db):
    return UnitFactory.create()


@pytest.fixture
def auth_client(client, user):
    client.force_authenticate(user=user)
    return client, user


def make_checkin(unit, user, location=None, **kwargs):
    if location is None:
        location = LONDON
    with (
        patch("backend.models.send_email_to_subscribers_task.apply_async"),
        patch("backend.models.send_thank_you_email_task.apply_async"),
    ):
        return CheckIn.objects.create(unit=unit, created_by=user, location=location, **kwargs)


# ── Config ─────────────────────────────────────────────────────────────────────


class TestConfigView:
    def test_returns_200(self, client, db):
        res = client.get("/api/config/")
        assert res.status_code == 200  # noqa: PLR2004

    def test_contains_expected_keys(self, client, db):
        res = client.get("/api/config/")
        data = res.json()
        assert "maptilerKey" in data
        assert "allowRegistration" in data

    def test_anon_allowed(self, client, db):
        res = client.get("/api/config/")
        assert res.status_code == 200  # noqa: PLR2004


# ── Stats ──────────────────────────────────────────────────────────────────────


class TestStatsView:
    def test_returns_200(self, client, db):
        res = client.get("/api/stats/")
        assert res.status_code == 200  # noqa: PLR2004

    def test_contains_expected_keys(self, client, db):
        res = client.get("/api/stats/")
        data = res.json()
        assert "active_unit_count" in data
        assert "checkin_count" in data
        assert "contributing_user_count" in data
        assert "total_distance_traveled_km" in data

    def test_reflects_created_data(self, client, db):
        owner = UserFactory.create()
        unit = UnitFactory.create(admin_only_checkin=False)
        make_checkin(unit, owner, location=LONDON)
        make_checkin(unit, UserFactory.create(), location=PARIS)

        cache.delete(STATS_CACHE_KEY)
        res = client.get("/api/stats/")
        data = res.json()
        assert data["checkin_count"] >= 2  # noqa: PLR2004


# ── Globe Pins ─────────────────────────────────────────────────────────────────


class TestGlobePinsView:
    def test_returns_200(self, client, db):
        res = client.get("/api/globe-pins/")
        assert res.status_code == 200  # noqa: PLR2004

    def test_pins_key_present(self, client, db):
        res = client.get("/api/globe-pins/")
        assert "pins" in res.json()

    def test_pins_is_list(self, client, db):
        res = client.get("/api/globe-pins/")
        assert isinstance(res.json()["pins"], list)


# ── Unit ───────────────────────────────────────────────────────────────────────


class TestUnitRetrieve:
    def test_returns_200_for_existing_unit(self, client, unit):
        res = client.get(f"/api/units/{unit.identifier}/")
        assert res.status_code == 200  # noqa: PLR2004

    def test_returns_404_for_missing_unit(self, client, db):
        res = client.get("/api/units/DOES-NOT-99/")
        assert res.status_code == 404  # noqa: PLR2004

    def test_is_subscribed_false_for_anon(self, client, unit):
        res = client.get(f"/api/units/{unit.identifier}/")
        assert res.json()["is_subscribed"] is False

    def test_is_subscribed_false_when_not_subscribed(self, client, unit, user):
        client.force_authenticate(user=user)
        res = client.get(f"/api/units/{unit.identifier}/")
        assert res.json()["is_subscribed"] is False

    def test_is_subscribed_true_when_subscribed(self, client, unit, user):
        unit.subscribers.add(user)
        client.force_authenticate(user=user)
        res = client.get(f"/api/units/{unit.identifier}/")
        assert res.json()["is_subscribed"] is True

    def test_can_check_in_true_for_anon(self, client, unit):
        res = client.get(f"/api/units/{unit.identifier}/")
        assert res.json()["can_check_in"] is True

    def test_can_check_in_true_for_authenticated(self, client, unit, user):
        client.force_authenticate(user=user)
        res = client.get(f"/api/units/{unit.identifier}/")
        assert res.json()["can_check_in"] is True


# ── Subscribe / Unsubscribe ────────────────────────────────────────────────────


class TestSubscribeEndpoint:
    def test_anon_subscribe_returns_401(self, client, unit):
        res = client.post(f"/api/units/{unit.identifier}/subscribe/")
        assert res.status_code == 401  # noqa: PLR2004

    def test_auth_subscribe_returns_204(self, client, unit, user):
        client.force_authenticate(user=user)
        res = client.post(f"/api/units/{unit.identifier}/subscribe/")
        assert res.status_code == 204  # noqa: PLR2004
        assert unit.subscribers.filter(pk=user.pk).exists()

    def test_anon_unsubscribe_returns_401(self, client, unit):
        res = client.delete(f"/api/units/{unit.identifier}/subscribe/")
        assert res.status_code == 401  # noqa: PLR2004

    def test_auth_unsubscribe_removes_subscription(self, client, unit, user):
        unit.subscribers.add(user)
        client.force_authenticate(user=user)
        res = client.delete(f"/api/units/{unit.identifier}/subscribe/")
        assert res.status_code == 204  # noqa: PLR2004
        assert not unit.subscribers.filter(pk=user.pk).exists()

    def test_subscribe_nonexistent_unit_returns_404(self, client, user, db):
        client.force_authenticate(user=user)
        res = client.post("/api/units/NONE-99/subscribe/")
        assert res.status_code == 404  # noqa: PLR2004


# ── CheckIn List ───────────────────────────────────────────────────────────────


class TestCheckInList:
    def test_anon_can_list(self, client, unit):
        res = client.get(f"/api/units/{unit.identifier}/checkins/")
        assert res.status_code == 200  # noqa: PLR2004

    def test_returns_checkins_for_unit(self, client, unit, user):
        make_checkin(unit, user)
        res = client.get(f"/api/units/{unit.identifier}/checkins/")
        assert len(res.json()) >= 1

    def test_does_not_return_checkins_from_other_unit(self, client, db):
        unit_a = UnitFactory.create()
        unit_b = UnitFactory.create()
        owner = UserFactory.create()
        make_checkin(unit_b, owner)
        res = client.get(f"/api/units/{unit_a.identifier}/checkins/")
        assert len(res.json()) == 0


# ── CheckIn Partial Update ─────────────────────────────────────────────────────


class TestCheckInPartialUpdate:
    def test_owner_can_edit_within_grace_period(self, client, unit, user):
        checkin = make_checkin(unit, user)
        client.force_authenticate(user=user)
        res = client.patch(
            f"/api/units/{unit.identifier}/checkins/{checkin.pk}/",
            {"message": "updated"},
        )
        assert res.status_code == 200  # noqa: PLR2004

    def test_non_owner_gets_403(self, client, unit, user):
        owner = UserFactory.create()
        checkin = make_checkin(unit, owner)
        client.force_authenticate(user=user)
        res = client.patch(
            f"/api/units/{unit.identifier}/checkins/{checkin.pk}/",
            {"message": "sneaky edit"},
        )
        assert res.status_code == 403  # noqa: PLR2004

    def test_owner_blocked_after_grace_period(self, client, unit, user):
        checkin = make_checkin(unit, user)
        checkin.date_created = timezone.now() - timedelta(hours=CHECKIN_EDIT_GRACE_PERIOD_HOURS + 1)
        checkin.save()
        client.force_authenticate(user=user)
        res = client.patch(
            f"/api/units/{unit.identifier}/checkins/{checkin.pk}/",
            {"message": "too late"},
        )
        assert res.status_code == 403  # noqa: PLR2004

    def test_anon_gets_403(self, client, unit, user):
        checkin = make_checkin(unit, user)
        res = client.patch(
            f"/api/units/{unit.identifier}/checkins/{checkin.pk}/",
            {"message": "anon edit"},
        )
        assert res.status_code == 403  # noqa: PLR2004

    def test_location_is_read_only(self, client, unit, user):
        checkin = make_checkin(unit, user, location=LONDON)
        client.force_authenticate(user=user)
        paris_payload = {"type": "Point", "coordinates": [2.3522, 48.8566]}
        res = client.patch(
            f"/api/units/{unit.identifier}/checkins/{checkin.pk}/",
            {"location": paris_payload},
            format="json",
        )
        assert res.status_code == 200  # noqa: PLR2004
        coords = res.json()["location"]["coordinates"]
        assert coords[0] == pytest.approx(-0.1278, abs=0.001)  # still London lng
        assert coords[1] == pytest.approx(51.5074, abs=0.001)  # still London lat


# ── CheckIn Destroy ────────────────────────────────────────────────────────────


class TestCheckInDestroy:
    def test_owner_can_delete_within_grace_period(self, client, unit, user):
        checkin = make_checkin(unit, user)
        client.force_authenticate(user=user)
        res = client.delete(f"/api/units/{unit.identifier}/checkins/{checkin.pk}/")
        assert res.status_code == 204  # noqa: PLR2004
        assert not CheckIn.objects.filter(pk=checkin.pk).exists()

    def test_non_owner_gets_403(self, client, unit, user):
        owner = UserFactory.create()
        checkin = make_checkin(unit, owner)
        client.force_authenticate(user=user)
        res = client.delete(f"/api/units/{unit.identifier}/checkins/{checkin.pk}/")
        assert res.status_code == 403  # noqa: PLR2004

    def test_owner_blocked_after_grace_period(self, client, unit, user):
        checkin = make_checkin(unit, user)
        checkin.date_created = timezone.now() - timedelta(hours=CHECKIN_DELETE_GRACE_PERIOD_HOURS + 1)
        checkin.save()
        client.force_authenticate(user=user)
        res = client.delete(f"/api/units/{unit.identifier}/checkins/{checkin.pk}/")
        assert res.status_code == 403  # noqa: PLR2004

    def test_anon_gets_403(self, client, unit, user):
        checkin = make_checkin(unit, user)
        res = client.delete(f"/api/units/{unit.identifier}/checkins/{checkin.pk}/")
        assert res.status_code == 403  # noqa: PLR2004


# ── CheckIn Message Validation ────────────────────────────────────────────────


LONDON_PAYLOAD = {"type": "Point", "coordinates": [-0.1278, 51.5074]}


class TestCheckInMessageValidation:
    def test_url_in_message_on_create_surfaces_as_field_error(self, client, unit, user):
        client.force_authenticate(user=user)
        with (
            patch("backend.models.send_email_to_subscribers_task.apply_async"),
            patch("backend.models.send_thank_you_email_task.apply_async"),
        ):
            res = client.post(
                f"/api/units/{unit.identifier}/checkins/",
                {"location": LONDON_PAYLOAD, "message": "https://spam.com"},
                format="json",
            )
        assert res.status_code == 400  # noqa: PLR2004
        data = res.json()
        assert "message" in data
        assert "non_field_errors" not in data

    def test_url_in_message_on_edit_surfaces_as_field_error(self, client, unit, user):
        checkin = make_checkin(unit, user)
        client.force_authenticate(user=user)
        res = client.patch(
            f"/api/units/{unit.identifier}/checkins/{checkin.pk}/",
            {"message": "https://spam.com"},
        )
        assert res.status_code == 400  # noqa: PLR2004
        data = res.json()
        assert "message" in data
        assert "non_field_errors" not in data

    def test_plain_message_is_accepted(self, client, unit, user):
        client.force_authenticate(user=user)
        with (
            patch("backend.models.send_email_to_subscribers_task.apply_async"),
            patch("backend.models.send_thank_you_email_task.apply_async"),
        ):
            res = client.post(
                f"/api/units/{unit.identifier}/checkins/",
                {"location": LONDON_PAYLOAD, "message": "Found it near the old market!"},
                format="json",
            )
        assert res.status_code == 201  # noqa: PLR2004


# ── CheckIn Admin-Only Unit ────────────────────────────────────────────────────


class TestAdminOnlyCheckin:
    def test_regular_user_gets_403(self, client, db):
        admin_unit = UnitFactory.create(admin_only_checkin=True)
        user = UserFactory.create()
        client.force_authenticate(user=user)
        res = client.post(
            f"/api/units/{admin_unit.identifier}/checkins/",
            {"location": {"type": "Point", "coordinates": [-0.1278, 51.5074]}},
            format="json",
        )
        assert res.status_code == 403  # noqa: PLR2004

    def test_superuser_can_checkin(self, client, db):
        admin_unit = UnitFactory.create(admin_only_checkin=True)
        superuser = UserFactory.create(is_superuser=True)
        client.force_authenticate(user=superuser)
        with (
            patch("backend.models.send_email_to_subscribers_task.apply_async"),
            patch("backend.models.send_thank_you_email_task.apply_async"),
        ):
            res = client.post(
                f"/api/units/{admin_unit.identifier}/checkins/",
                {"location": {"type": "Point", "coordinates": [-0.1278, 51.5074]}},
                format="json",
            )
        assert res.status_code == 201  # noqa: PLR2004


# ── Unit game field ────────────────────────────────────────────────────────────


class TestUnitGameField:
    def test_game_null_when_no_game(self, client, unit):
        res = client.get(f"/api/units/{unit.identifier}/")
        assert res.json()["game"] is None

    def test_game_fields_when_game_attached(self, client, db):
        game = Game.objects.create(mode=Game.Modes.RACE, name="Race A")
        unit = UnitFactory.create(game=game)
        res = client.get(f"/api/units/{unit.identifier}/")
        data = res.json()["game"]
        assert data["mode"] == "race"
        assert "max_gps_drift" in data
        assert "allowed_time" in data
        assert "shelf_life" in data


# ── Location Claim ─────────────────────────────────────────────────────────────


class TestLocationClaimView:
    @pytest.fixture(autouse=True)
    def _clear_cache(self):
        cache.clear()
        yield
        cache.clear()

    def test_anon_returns_token(self, client, unit):
        # Anonymous users can claim a location so GPS-enforced anonymous check-ins work.
        # The token binds user_id=None; authenticated tokens are not interchangeable.
        res = client.post(
            "/api/location-claim/",
            {"lat": 51.5, "lng": -0.1, "accuracy": 10.0, "unit_identifier": unit.identifier},
            format="json",
        )
        assert res.status_code == 200  # noqa: PLR2004
        assert isinstance(res.json().get("token"), str)

    def test_missing_fields_returns_400(self, client, user):
        client.force_authenticate(user=user)
        res = client.post("/api/location-claim/", {}, format="json")
        assert res.status_code == 400  # noqa: PLR2004

    def test_unknown_unit_returns_404(self, client, user, db):
        client.force_authenticate(user=user)
        res = client.post(
            "/api/location-claim/",
            {"lat": 51.5, "lng": -0.1, "accuracy": 10.0, "unit_identifier": "no-such-unit"},
            format="json",
        )
        assert res.status_code == 404  # noqa: PLR2004

    def test_accuracy_too_low_returns_400(self, client, user, unit):
        client.force_authenticate(user=user)
        res = client.post(
            "/api/location-claim/",
            {"lat": 51.5, "lng": -0.1, "accuracy": 500.0, "unit_identifier": unit.identifier},
            format="json",
        )
        assert res.status_code == 400  # noqa: PLR2004

    def test_returns_token_string(self, client, user, unit):
        client.force_authenticate(user=user)
        res = client.post(
            "/api/location-claim/",
            {"lat": 51.5074, "lng": -0.1278, "accuracy": 10.0, "unit_identifier": unit.identifier},
            format="json",
        )
        assert res.status_code == 200  # noqa: PLR2004
        assert isinstance(res.json().get("token"), str)

    def test_rate_limit_returns_429(self, client, user, unit, settings):
        # Use a tight per-test limit so we don't hammer the endpoint
        settings.ACCOUNT_RATE_LIMITS = {**settings.ACCOUNT_RATE_LIMITS, "location_claim": "2/m"}
        client.force_authenticate(user=user)
        body = {"lat": 51.5074, "lng": -0.1278, "accuracy": 10.0, "unit_identifier": unit.identifier}
        # First two should succeed, third trips the limit
        for _ in range(2):
            assert client.post("/api/location-claim/", body, format="json").status_code == 200  # noqa: PLR2004
        res = client.post("/api/location-claim/", body, format="json")
        assert res.status_code == 429  # noqa: PLR2004


# ── CheckIn Create — GPS-enforced ──────────────────────────────────────────────


class TestCheckInCreateGpsEnforced:
    @pytest.fixture(autouse=True)
    def _clear_cache(self):
        cache.clear()
        yield
        cache.clear()

    @pytest.fixture
    def gps_unit(self, db):
        game = Game.objects.create(mode=Game.Modes.RACE, name="GPS Race")
        return UnitFactory.create(game=game)

    def test_missing_token_returns_400(self, client, gps_unit, user):
        client.force_authenticate(user=user)
        with (
            patch("backend.models.send_email_to_subscribers_task.apply_async"),
            patch("backend.models.send_thank_you_email_task.apply_async"),
        ):
            res = client.post(
                f"/api/units/{gps_unit.identifier}/checkins/",
                {"location": LONDON_PAYLOAD},
                format="json",
            )
        assert res.status_code == 400  # noqa: PLR2004
        assert "location_token" in res.json()

    def test_valid_token_creates_checkin(self, client, gps_unit, user):
        token = issue_location_claim(51.5074, -0.1278, 10.0, user.id, unit_identifier=gps_unit.identifier)
        client.force_authenticate(user=user)
        with (
            patch("backend.models.send_email_to_subscribers_task.apply_async"),
            patch("backend.models.send_thank_you_email_task.apply_async"),
        ):
            res = client.post(
                f"/api/units/{gps_unit.identifier}/checkins/",
                {"location": LONDON_PAYLOAD, "location_token": token, "place": "London"},
                format="json",
            )
        assert res.status_code == 201  # noqa: PLR2004

    def test_token_wrong_user_returns_400(self, client, gps_unit, user, db):
        other = UserFactory.create()
        token = issue_location_claim(51.5074, -0.1278, 10.0, other.id, unit_identifier=gps_unit.identifier)
        client.force_authenticate(user=user)
        with (
            patch("backend.models.send_email_to_subscribers_task.apply_async"),
            patch("backend.models.send_thank_you_email_task.apply_async"),
        ):
            res = client.post(
                f"/api/units/{gps_unit.identifier}/checkins/",
                {"location": LONDON_PAYLOAD, "location_token": token},
                format="json",
            )
        assert res.status_code == 400  # noqa: PLR2004

    def test_token_wrong_unit_returns_400(self, client, gps_unit, user, db):
        other_game = Game.objects.create(mode=Game.Modes.RACE, name="Other GPS Race")
        other_unit = UnitFactory.create(game=other_game)
        token = issue_location_claim(51.5074, -0.1278, 10.0, user.id, unit_identifier=other_unit.identifier)
        client.force_authenticate(user=user)
        with (
            patch("backend.models.send_email_to_subscribers_task.apply_async"),
            patch("backend.models.send_thank_you_email_task.apply_async"),
        ):
            res = client.post(
                f"/api/units/{gps_unit.identifier}/checkins/",
                {"location": LONDON_PAYLOAD, "location_token": token},
                format="json",
            )
        assert res.status_code == 400  # noqa: PLR2004
        assert "different unit" in str(res.json())

    def test_replay_returns_400(self, client, gps_unit, user):
        token = issue_location_claim(51.5074, -0.1278, 10.0, user.id, unit_identifier=gps_unit.identifier)
        client.force_authenticate(user=user)
        body = {"location": LONDON_PAYLOAD, "location_token": token, "place": "London"}
        with (
            patch("backend.models.send_email_to_subscribers_task.apply_async"),
            patch("backend.models.send_thank_you_email_task.apply_async"),
        ):
            first = client.post(f"/api/units/{gps_unit.identifier}/checkins/", body, format="json")
            second = client.post(f"/api/units/{gps_unit.identifier}/checkins/", body, format="json")
        assert first.status_code == 201  # noqa: PLR2004
        assert second.status_code == 400  # noqa: PLR2004
        assert "already used" in str(second.json())

    def test_location_beyond_drift_returns_400(self, client, gps_unit, user):
        token = issue_location_claim(51.5074, -0.1278, 10.0, user.id, unit_identifier=gps_unit.identifier)
        client.force_authenticate(user=user)
        with (
            patch("backend.models.send_email_to_subscribers_task.apply_async"),
            patch("backend.models.send_thank_you_email_task.apply_async"),
        ):
            res = client.post(
                f"/api/units/{gps_unit.identifier}/checkins/",
                # ~666 m north — beyond the default 500 m drift
                {"location": {"type": "Point", "coordinates": [-0.1278, 51.5134]}, "location_token": token},
                format="json",
            )
        assert res.status_code == 400  # noqa: PLR2004

    def test_anon_missing_token_returns_400(self, client, gps_unit):
        res = client.post(
            f"/api/units/{gps_unit.identifier}/checkins/",
            {"location": LONDON_PAYLOAD},
            format="json",
        )
        assert res.status_code == 400  # noqa: PLR2004
        assert "location_token" in res.json()

    def test_anon_valid_token_creates_checkin(self, client, gps_unit):
        token = issue_location_claim(51.5074, -0.1278, 10.0, None, unit_identifier=gps_unit.identifier)
        with (
            patch("backend.models.send_email_to_subscribers_task.apply_async"),
            patch("backend.models.send_thank_you_email_task.apply_async"),
        ):
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
        assert res.status_code == 201  # noqa: PLR2004

    def test_anon_authed_token_rejected(self, client, gps_unit, user):
        # A token minted for an authenticated user must not be accepted anonymously.
        token = issue_location_claim(51.5074, -0.1278, 10.0, user.id, unit_identifier=gps_unit.identifier)
        with (
            patch("backend.models.send_email_to_subscribers_task.apply_async"),
            patch("backend.models.send_thank_you_email_task.apply_async"),
        ):
            res = client.post(
                f"/api/units/{gps_unit.identifier}/checkins/",
                {"location": LONDON_PAYLOAD, "location_token": token},
                format="json",
            )
        assert res.status_code == 400  # noqa: PLR2004

    def test_auth_missing_place_returns_400(self, client, gps_unit, user):
        token = issue_location_claim(51.5074, -0.1278, 10.0, user.id, unit_identifier=gps_unit.identifier)
        client.force_authenticate(user=user)
        res = client.post(
            f"/api/units/{gps_unit.identifier}/checkins/",
            {"location": LONDON_PAYLOAD, "location_token": token},
            format="json",
        )
        assert res.status_code == 400  # noqa: PLR2004
        assert "place" in res.json()

    def test_auth_junk_place_rejected(self, client, gps_unit, user):
        # Punctuation-only place doesn't satisfy the word-character minimum.
        token = issue_location_claim(51.5074, -0.1278, 10.0, user.id, unit_identifier=gps_unit.identifier)
        client.force_authenticate(user=user)
        res = client.post(
            f"/api/units/{gps_unit.identifier}/checkins/",
            {"location": LONDON_PAYLOAD, "location_token": token, "place": "..."},
            format="json",
        )
        assert res.status_code == 400  # noqa: PLR2004
        assert "place" in res.json()

    def test_auth_unicode_place_accepted(self, client, gps_unit, user):
        # Mirrors the frontend regex /[\p{L}\p{N}]/gu — non-ASCII letters count.
        token = issue_location_claim(51.5074, -0.1278, 10.0, user.id, unit_identifier=gps_unit.identifier)
        client.force_authenticate(user=user)
        with (
            patch("backend.models.send_email_to_subscribers_task.apply_async"),
            patch("backend.models.send_thank_you_email_task.apply_async"),
        ):
            res = client.post(
                f"/api/units/{gps_unit.identifier}/checkins/",
                {"location": LONDON_PAYLOAD, "location_token": token, "place": "東京都"},
                format="json",
            )
        assert res.status_code == 201  # noqa: PLR2004

    def test_anon_missing_anonymous_name_returns_400(self, client, gps_unit):
        token = issue_location_claim(51.5074, -0.1278, 10.0, None, unit_identifier=gps_unit.identifier)
        res = client.post(
            f"/api/units/{gps_unit.identifier}/checkins/",
            {"location": LONDON_PAYLOAD, "location_token": token, "place": "London"},
            format="json",
        )
        assert res.status_code == 400  # noqa: PLR2004
        assert "anonymous_name" in res.json()

    def test_anon_junk_anonymous_name_rejected(self, client, gps_unit):
        token = issue_location_claim(51.5074, -0.1278, 10.0, None, unit_identifier=gps_unit.identifier)
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
        assert res.status_code == 400  # noqa: PLR2004
        assert "anonymous_name" in res.json()

    def test_non_gps_unit_does_not_require_place(self, client, user, db):
        # Plain (no game) unit — game-mode required-fields validation must not fire.
        plain_unit = UnitFactory.create()
        client.force_authenticate(user=user)
        with (
            patch("backend.models.send_email_to_subscribers_task.apply_async"),
            patch("backend.models.send_thank_you_email_task.apply_async"),
        ):
            res = client.post(
                f"/api/units/{plain_unit.identifier}/checkins/",
                {"location": LONDON_PAYLOAD},
                format="json",
            )
        assert res.status_code == 201  # noqa: PLR2004


# ── Game Leaderboard ───────────────────────────────────────────────────────────


class TestGameLeaderboard:
    @pytest.fixture(autouse=True)
    def _clear_cache(self):
        cache.clear()
        yield
        cache.clear()

    def test_returns_404_for_missing_game(self, client, db):
        res = client.get("/api/games/9999/leaderboard/")
        assert res.status_code == 404  # noqa: PLR2004

    def test_returns_200_for_valid_game(self, client, db):
        game = Game.objects.create(mode=Game.Modes.DISTANCE, name="Spring Challenge")
        res = client.get(f"/api/games/{game.id}/leaderboard/")
        assert res.status_code == 200  # noqa: PLR2004
        data = res.json()
        assert data["game"]["id"] == game.id
        assert data["game"]["mode"] == "distance"
        assert data["game"]["name"] == "Spring Challenge"
        assert data["individual"] == []
        assert data["teams"] is None

    def test_individual_entries_sorted_by_distance(self, client, user, db):
        game = GameFactory.create(mode=Game.Modes.DISTANCE)
        unit_a = UnitFactory.create(game=game)
        unit_b = UnitFactory.create(game=game)
        # unit_a: London → Paris (~344 km). unit_b: London only (0 km).
        make_checkin(unit_a, user, location=LONDON)
        other = UserFactory.create()
        make_checkin(unit_a, other, location=PARIS)
        make_checkin(unit_b, user, location=LONDON)

        # Pass ?from=<unit_a> so that row keeps its identifier; the other row
        # should have identifier=null (anti-enumeration).
        res = client.get(f"/api/games/{game.id}/leaderboard/?from={unit_a.identifier}")
        data = res.json()
        assert data["individual"][0]["identifier"] == unit_a.identifier
        assert data["individual"][1]["identifier"] is None
        assert data["individual"][0]["rank"] == 1
        assert data["individual"][0]["distance_km"] > 0
        assert data["individual"][1]["distance_km"] == 0
        assert "place" in data["individual"][0]

    def test_teams_section_null_when_no_units_have_team(self, client, user, db):
        game = GameFactory.create(mode=Game.Modes.DISTANCE)
        UnitFactory.create(game=game)
        res = client.get(f"/api/games/{game.id}/leaderboard/")
        assert res.json()["teams"] is None

    def test_teams_section_aggregates_correctly(self, client, user, db):
        from backend.models import Team  # noqa: PLC0415

        team_blue = Team.objects.create(name="blue", color="#3b6ea5")
        team_red = Team.objects.create(name="red", color="#c94c35")
        game = GameFactory.create(mode=Game.Modes.DISTANCE)
        unit_a = UnitFactory.create(game=game, team=team_blue)
        unit_b = UnitFactory.create(game=game, team=team_blue)
        unit_c = UnitFactory.create(game=game, team=team_red)
        make_checkin(unit_a, user, location=LONDON)
        make_checkin(unit_a, UserFactory.create(), location=PARIS)
        make_checkin(unit_b, user, location=LONDON)
        make_checkin(unit_c, user, location=LONDON)

        res = client.get(f"/api/games/{game.id}/leaderboard/")
        teams = res.json()["teams"]
        assert teams is not None
        assert {t["team"]["name"] for t in teams} == {"blue", "red"}
        blue = next(t for t in teams if t["team"]["name"] == "blue")
        assert blue["team"]["color"] == "#3b6ea5"
        assert blue["lighter_count"] == 2  # noqa: PLR2004
        assert blue["distance_km"] > 0
        assert blue["rank"] == 1
        # ignored teams: unit_c (red) — only unit, 0 km
        _ = unit_b, unit_c

    def test_distance_mode_sort_by_distance_km(self, client, db):
        game = Game.objects.create(mode=Game.Modes.DISTANCE, name="D")
        res = client.get(f"/api/games/{game.id}/leaderboard/")
        assert res.json()["game"]["sort_by"] == "distance_km"

    def test_identifiers_hidden_without_from_param(self, client, user, db):
        """Anti-enumeration: a public caller without ?from= sees no identifiers."""
        game = GameFactory.create(mode=Game.Modes.DISTANCE)
        unit_a = UnitFactory.create(game=game)
        unit_b = UnitFactory.create(game=game)
        make_checkin(unit_a, user, location=LONDON)
        make_checkin(unit_b, user, location=LONDON)

        res = client.get(f"/api/games/{game.id}/leaderboard/")
        identifiers = [r["identifier"] for r in res.json()["individual"]]
        assert all(i is None for i in identifiers)

    def test_unknown_from_identifier_still_hides_all(self, client, user, db):
        """A ?from=<bogus> caller still sees no identifiers — can't probe."""
        game = GameFactory.create(mode=Game.Modes.DISTANCE)
        unit = UnitFactory.create(game=game)
        make_checkin(unit, user, location=LONDON)

        res = client.get(f"/api/games/{game.id}/leaderboard/?from=does-not-exist")
        identifiers = [r["identifier"] for r in res.json()["individual"]]
        assert all(i is None for i in identifiers)

    def test_from_filter_does_not_pollute_cache(self, client, user, db):
        """Sequential calls with different ?from= values must each see only their
        own identifier — proves the cache stores the canonical full data and the
        filter runs at the response boundary."""
        game = GameFactory.create(mode=Game.Modes.DISTANCE)
        unit_a = UnitFactory.create(game=game)
        unit_b = UnitFactory.create(game=game)
        make_checkin(unit_a, user, location=LONDON)
        make_checkin(unit_b, user, location=LONDON)

        first = client.get(f"/api/games/{game.id}/leaderboard/?from={unit_a.identifier}").json()
        second = client.get(f"/api/games/{game.id}/leaderboard/?from={unit_b.identifier}").json()

        first_ids = {r["identifier"] for r in first["individual"]}
        second_ids = {r["identifier"] for r in second["individual"]}
        assert first_ids == {unit_a.identifier, None}
        assert second_ids == {unit_b.identifier, None}

    def test_hot_potato_sorted_by_checkin_count(self, client, user, db):
        game = GameFactory.create(mode=Game.Modes.HOT_POTATO)
        unit_a = UnitFactory.create(game=game)
        unit_b = UnitFactory.create(game=game)
        # unit_a: 3 check-ins, all at the same spot — 0 km traveled
        for _ in range(3):
            make_checkin(unit_a, UserFactory.create(), location=LONDON)
        # unit_b: London → Paris — ~344 km but only 2 check-ins
        make_checkin(unit_b, UserFactory.create(), location=LONDON)
        make_checkin(unit_b, UserFactory.create(), location=PARIS)

        res = client.get(f"/api/games/{game.id}/leaderboard/?from={unit_a.identifier}")
        data = res.json()
        assert data["game"]["sort_by"] == "checkin_count"
        # unit_a comes back identifiable because it's the ?from= row
        assert data["individual"][0]["identifier"] == unit_a.identifier
        assert data["individual"][1]["identifier"] is None
        assert data["individual"][0]["rank"] == 1
        assert data["individual"][0]["checkin_count"] == 3  # noqa: PLR2004
        assert data["individual"][1]["checkin_count"] == 2  # noqa: PLR2004


# ── Distance Game: time limit is informational only ────────────────────────────


class TestDistanceGameTimeLimit:
    def test_checkin_not_blocked_after_distance_time_limit(self, client, db):
        """Once the Distance game time limit elapses, the lighter is out of the
        running but check-ins are NOT blocked — the journey continues."""
        game = GameFactory.create(mode=Game.Modes.DISTANCE, allowed_time=1)  # 1 hour
        unit = UnitFactory.create(game=game)
        token_user = UserFactory.create()
        # Place the first check-in well past the allowed_time (10 hours ago).
        first = make_checkin(unit, token_user, location=LONDON)
        first.date_created = timezone.now() - timedelta(hours=10)
        first.save()

        # Now another user attempts a check-in. It must succeed.
        next_user = UserFactory.create()
        token = issue_location_claim(48.8566, 2.3522, 10.0, next_user.id, unit_identifier=unit.identifier)
        client.force_authenticate(user=next_user)
        with (
            patch("backend.models.send_email_to_subscribers_task.apply_async"),
            patch("backend.models.send_thank_you_email_task.apply_async"),
        ):
            res = client.post(
                f"/api/units/{unit.identifier}/checkins/",
                {
                    "location": {"type": "Point", "coordinates": [2.3522, 48.8566]},
                    "location_token": token,
                    "place": "Paris",
                },
                format="json",
            )
        assert res.status_code == 201  # noqa: PLR2004
