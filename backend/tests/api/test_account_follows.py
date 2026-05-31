"""GET /api/account/follows/ — units the authenticated user follows."""

from __future__ import annotations

from rest_framework import status

from backend.factories import GameFactory, UnitFactory
from backend.models import Team

URL = "/api/account/follows/"


class TestAccountFollowsView:
    def test_anon_returns_403(self, client, db):
        # SessionAuthentication is the primary authenticator and has no
        # authenticate_header(), so DRF's IsAuthenticated returns 403 (not 401)
        # for anonymous callers. PrivateRoute redirects before the user ever
        # sees this; the loader treats the 403 as an empty list.
        res = client.get(URL)
        assert res.status_code == status.HTTP_403_FORBIDDEN

    def test_empty_when_no_follows(self, auth_client):
        res = auth_client.get(URL)
        assert res.status_code == status.HTTP_200_OK
        assert res.json() == []

    def test_returns_last_checkin_fields(self, auth_client, user, unit, make_checkin):
        unit.followers.add(user)
        make_checkin(unit, user, place="Pier 1")

        res = auth_client.get(URL)
        assert res.status_code == status.HTTP_200_OK
        (item,) = res.json()
        assert item["identifier"] == unit.identifier
        assert item["last_checkin_place"] == "Pier 1"
        assert item["last_checkin_by"] == user.name
        assert item["last_checkin_date"] is not None

    def test_anonymous_checkin_who(self, auth_client, user, unit, make_checkin):
        unit.followers.add(user)
        make_checkin(unit, anonymous=True, anonymous_name="Bob")

        (item,) = auth_client.get(URL).json()
        assert item["last_checkin_by"] == "Bob"

    def test_anonymous_checkin_without_name_is_null(self, auth_client, user, unit, make_checkin):
        unit.followers.add(user)
        make_checkin(unit, anonymous=True, anonymous_name="")

        (item,) = auth_client.get(URL).json()
        assert item["last_checkin_by"] is None

    def test_unit_with_no_checkins_has_null_fields(self, auth_client, user, unit):
        unit.followers.add(user)

        (item,) = auth_client.get(URL).json()
        assert item["last_checkin_date"] is None
        assert item["last_checkin_place"] is None
        assert item["last_checkin_by"] is None

    def test_ordering_recent_first_nulls_last(self, auth_client, user, make_checkin):
        recent = UnitFactory.create()
        old = UnitFactory.create()
        never = UnitFactory.create()
        for u in (recent, old, never):
            u.followers.add(user)
        make_checkin(recent, user, hours_ago=1)
        make_checkin(old, user, hours_ago=100)

        identifiers = [item["identifier"] for item in auth_client.get(URL).json()]
        assert identifiers == [recent.identifier, old.identifier, never.identifier]

    def test_latest_checkin_wins(self, auth_client, user, unit, make_checkin):
        unit.followers.add(user)
        make_checkin(unit, user, place="Old Town", hours_ago=48)
        make_checkin(unit, user, place="New Harbour", hours_ago=1)

        (item,) = auth_client.get(URL).json()
        assert item["last_checkin_place"] == "New Harbour"

    def test_game_and_team_fields(self, auth_client, user):
        team = Team.objects.create(name="reds", color="#c94c35")
        unit = UnitFactory.create(game=GameFactory.create(name="Summer Relay"), team=team)
        unit.followers.add(user)

        (item,) = auth_client.get(URL).json()
        assert item["game"]["name"] == "Summer Relay"
        assert item["team"] == {"name": "reds", "color": "#c94c35"}

    def test_game_and_team_null_when_unset(self, auth_client, user, unit):
        unit.followers.add(user)

        (item,) = auth_client.get(URL).json()
        assert item["game"] is None
        assert item["team"] is None
