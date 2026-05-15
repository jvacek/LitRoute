"""GET /api/units/<identifier>/ — retrieve, subscription state, game payload."""

from __future__ import annotations

from rest_framework import status

from backend.factories import UnitFactory
from backend.models import Game


class TestUnitRetrieve:
    def test_returns_200_for_existing_unit(self, client, unit):
        res = client.get(f"/api/units/{unit.identifier}/")
        assert res.status_code == status.HTTP_200_OK

    def test_returns_404_for_missing_unit(self, client, db):
        res = client.get("/api/units/DOES-NOT-99/")
        assert res.status_code == status.HTTP_404_NOT_FOUND


class TestUnitSubscriptionState:
    def test_is_subscribed_false_for_anon(self, client, unit):
        assert client.get(f"/api/units/{unit.identifier}/").json()["is_subscribed"] is False

    def test_is_subscribed_false_when_not_subscribed(self, auth_client, unit):
        assert auth_client.get(f"/api/units/{unit.identifier}/").json()["is_subscribed"] is False

    def test_is_subscribed_true_when_subscribed(self, auth_client, unit, user):
        unit.subscribers.add(user)
        assert auth_client.get(f"/api/units/{unit.identifier}/").json()["is_subscribed"] is True


class TestUnitCheckInCapability:
    def test_can_check_in_true_for_anon(self, client, unit):
        assert client.get(f"/api/units/{unit.identifier}/").json()["can_check_in"] is True

    def test_can_check_in_true_for_authenticated(self, auth_client, unit):
        assert auth_client.get(f"/api/units/{unit.identifier}/").json()["can_check_in"] is True

    def test_can_check_in_false_for_admin_only_unit(self, client, db):
        admin_unit = UnitFactory.create(admin_only_checkin=True)
        assert client.get(f"/api/units/{admin_unit.identifier}/").json()["can_check_in"] is False


class TestUnitGameField:
    def test_game_null_when_no_game(self, client, unit):
        assert client.get(f"/api/units/{unit.identifier}/").json()["game"] is None

    def test_game_fields_when_game_attached(self, client, db):
        game = Game.objects.create(mode=Game.Modes.RACE, name="Race A")
        unit = UnitFactory.create(game=game)
        data = client.get(f"/api/units/{unit.identifier}/").json()["game"]
        assert data["mode"] == "race"
        assert "gps_drift_floor" in data
        assert "allowed_time" in data
        assert "shelf_life" in data
