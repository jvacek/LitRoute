from __future__ import annotations

from datetime import timedelta
from unittest.mock import patch

import pytest
from django.contrib.gis.geos import Point
from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APIClient

from backend.factories import UnitFactory
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
        game = Game.objects.create(mode=Game.Modes.RACE)
        unit = UnitFactory.create(game=game)
        res = client.get(f"/api/units/{unit.identifier}/")
        data = res.json()["game"]
        assert data["mode"] == "race"
        assert "max_gps_drift" in data
        assert "allowed_time" in data
        assert "shelf_life" in data


# ── Location Claim ─────────────────────────────────────────────────────────────


class TestLocationClaimView:
    def test_anon_returns_403(self, client, db):
        res = client.post(
            "/api/location-claim/",
            {"lat": 51.5, "lng": -0.1, "accuracy": 10.0},
            format="json",
        )
        assert res.status_code == 403  # noqa: PLR2004

    def test_missing_fields_returns_400(self, client, user):
        client.force_authenticate(user=user)
        res = client.post("/api/location-claim/", {}, format="json")
        assert res.status_code == 400  # noqa: PLR2004

    def test_returns_token_string(self, client, user):
        client.force_authenticate(user=user)
        res = client.post(
            "/api/location-claim/",
            {"lat": 51.5074, "lng": -0.1278, "accuracy": 10.0},
            format="json",
        )
        assert res.status_code == 200  # noqa: PLR2004
        assert isinstance(res.json().get("token"), str)


# ── CheckIn Create — GPS-enforced ──────────────────────────────────────────────


class TestCheckInCreateGpsEnforced:
    @pytest.fixture
    def gps_unit(self, db):
        game = Game.objects.create(mode=Game.Modes.RACE)
        return UnitFactory.create(game=game)

    def test_missing_token_returns_400(self, client, gps_unit, user):
        client.force_authenticate(user=user)
        with (
            patch("backend.models.send_email_to_subscribers_task.apply_async"),
            patch("backend.models.send_thank_you_email_task.apply_async"),
        ):
            res = client.post(
                f"/api/units/{gps_unit.identifier}/checkins/",
                {"location": "51.5074,-0.1278"},
            )
        assert res.status_code == 400  # noqa: PLR2004
        assert "location_token" in res.json()

    def test_valid_token_creates_checkin(self, client, gps_unit, user):
        token = issue_location_claim(51.5074, -0.1278, 10.0, user.id)
        client.force_authenticate(user=user)
        with (
            patch("backend.models.send_email_to_subscribers_task.apply_async"),
            patch("backend.models.send_thank_you_email_task.apply_async"),
        ):
            res = client.post(
                f"/api/units/{gps_unit.identifier}/checkins/",
                {"location": "51.5074,-0.1278", "location_token": token},
            )
        assert res.status_code == 201  # noqa: PLR2004

    def test_token_wrong_user_returns_400(self, client, gps_unit, user, db):
        other = UserFactory.create()
        token = issue_location_claim(51.5074, -0.1278, 10.0, other.id)
        client.force_authenticate(user=user)
        with (
            patch("backend.models.send_email_to_subscribers_task.apply_async"),
            patch("backend.models.send_thank_you_email_task.apply_async"),
        ):
            res = client.post(
                f"/api/units/{gps_unit.identifier}/checkins/",
                {"location": "51.5074,-0.1278", "location_token": token},
            )
        assert res.status_code == 400  # noqa: PLR2004

    def test_location_beyond_drift_returns_400(self, client, gps_unit, user):
        token = issue_location_claim(51.5074, -0.1278, 10.0, user.id)
        client.force_authenticate(user=user)
        with (
            patch("backend.models.send_email_to_subscribers_task.apply_async"),
            patch("backend.models.send_thank_you_email_task.apply_async"),
        ):
            res = client.post(
                f"/api/units/{gps_unit.identifier}/checkins/",
                # ~666 m north — beyond the default 500 m drift
                {"location": "51.5134,-0.1278", "location_token": token},
            )
        assert res.status_code == 400  # noqa: PLR2004
