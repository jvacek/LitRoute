"""GET /api/games/<id>/leaderboard/ and GET /api/games/<id>/journeys/."""

from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework import status

from backend.factories import GameFactory, UnitFactory
from backend.models import CheckIn, Game
from backend.tests.conftest import LONDON, PARIS
from flamerelay.users.tests.factories import UserFactory


# Leaderboard/journeys responses are cached; reset around each test.
@pytest.fixture(autouse=True)
def _isolate_cache(clear_cache):
    pass


# ── Leaderboard ────────────────────────────────────────────────────────────────


class TestLeaderboardBasics:
    def test_returns_404_for_missing_game(self, client, db):
        res = client.get("/api/games/9999/leaderboard/")
        assert res.status_code == status.HTTP_404_NOT_FOUND

    def test_returns_200_for_valid_game(self, client, db):
        game = Game.objects.create(mode=Game.Modes.DISTANCE, name="Spring Challenge")
        res = client.get(f"/api/games/{game.id}/leaderboard/")
        assert res.status_code == status.HTTP_200_OK
        data = res.json()
        assert data["game"]["id"] == game.id
        assert data["game"]["mode"] == "distance"
        assert data["game"]["name"] == "Spring Challenge"
        assert data["individual"] == []
        assert data["teams"] is None

    def test_distance_mode_sort_by_distance_km(self, client, db):
        game = Game.objects.create(mode=Game.Modes.DISTANCE, name="D")
        assert client.get(f"/api/games/{game.id}/leaderboard/").json()["game"]["sort_by"] == "distance_km"


class TestLeaderboardScoring:
    def test_individual_entries_sorted_by_distance(self, client, user, db, make_checkin):
        game = GameFactory.create(mode=Game.Modes.DISTANCE)
        unit_a = UnitFactory.create(game=game)
        unit_b = UnitFactory.create(game=game)
        # unit_a: London → Paris (~344 km). unit_b: London only (0 km).
        make_checkin(unit_a, user, location=LONDON)
        make_checkin(unit_a, UserFactory.create(), location=PARIS)
        make_checkin(unit_b, user, location=LONDON)

        # Pass ?from=<unit_a> so that row keeps its identifier; the other row
        # should have identifier=null (anti-enumeration).
        data = client.get(f"/api/games/{game.id}/leaderboard/?from={unit_a.identifier}").json()
        assert data["individual"][0]["identifier"] == unit_a.identifier
        assert data["individual"][1]["identifier"] is None
        assert data["individual"][0]["rank"] == 1
        assert data["individual"][0]["distance_km"] > 0
        assert data["individual"][1]["distance_km"] == 0
        assert "place" in data["individual"][0]

    def test_hot_potato_sorted_by_checkin_count(self, client, db, make_checkin):
        game = GameFactory.create(mode=Game.Modes.HOT_POTATO)
        unit_a = UnitFactory.create(game=game)
        unit_b = UnitFactory.create(game=game)
        # unit_a: 3 check-ins, all at the same spot — 0 km traveled.
        for _ in range(3):
            make_checkin(unit_a, UserFactory.create(), location=LONDON)
        # unit_b: London → Paris — ~344 km but only 2 check-ins.
        make_checkin(unit_b, UserFactory.create(), location=LONDON)
        make_checkin(unit_b, UserFactory.create(), location=PARIS)

        data = client.get(f"/api/games/{game.id}/leaderboard/?from={unit_a.identifier}").json()
        assert data["game"]["sort_by"] == "checkin_count"
        # unit_a comes back identifiable because it's the ?from= row
        assert data["individual"][0]["identifier"] == unit_a.identifier
        assert data["individual"][1]["identifier"] is None
        assert data["individual"][0]["rank"] == 1
        assert data["individual"][0]["checkin_count"] == 3  # noqa: PLR2004
        assert data["individual"][1]["checkin_count"] == 2  # noqa: PLR2004


class TestLeaderboardTeams:
    def test_teams_section_null_when_no_units_have_team(self, client, db):
        game = GameFactory.create(mode=Game.Modes.DISTANCE)
        UnitFactory.create(game=game)
        assert client.get(f"/api/games/{game.id}/leaderboard/").json()["teams"] is None

    def test_teams_section_aggregates_correctly(self, client, user, db, make_checkin):
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

        teams = client.get(f"/api/games/{game.id}/leaderboard/").json()["teams"]
        assert teams is not None
        assert {t["team"]["name"] for t in teams} == {"blue", "red"}
        blue = next(t for t in teams if t["team"]["name"] == "blue")
        assert blue["team"]["color"] == "#3b6ea5"
        assert blue["lighter_count"] == 2  # noqa: PLR2004
        assert blue["distance_km"] > 0
        assert blue["rank"] == 1


class TestLeaderboardAntiEnumeration:
    """Only the row matching `?from=<identifier>` exposes its identifier;
    everything else is masked so callers can't probe for slugs."""

    def test_identifiers_hidden_without_from_param(self, client, user, db, make_checkin):
        game = GameFactory.create(mode=Game.Modes.DISTANCE)
        unit_a = UnitFactory.create(game=game)
        unit_b = UnitFactory.create(game=game)
        make_checkin(unit_a, user, location=LONDON)
        make_checkin(unit_b, user, location=LONDON)

        identifiers = [r["identifier"] for r in client.get(f"/api/games/{game.id}/leaderboard/").json()["individual"]]
        assert all(i is None for i in identifiers)

    def test_unknown_from_identifier_still_hides_all(self, client, user, db, make_checkin):
        game = GameFactory.create(mode=Game.Modes.DISTANCE)
        unit = UnitFactory.create(game=game)
        make_checkin(unit, user, location=LONDON)

        identifiers = [
            r["identifier"]
            for r in client.get(f"/api/games/{game.id}/leaderboard/?from=does-not-exist").json()["individual"]
        ]
        assert all(i is None for i in identifiers)

    def test_from_filter_does_not_pollute_cache(self, client, user, db, make_checkin):
        """Sequential calls with different `?from=` values must each see only
        their own identifier — proves the cache stores the canonical full data
        and the filter runs at the response boundary."""
        game = GameFactory.create(mode=Game.Modes.DISTANCE)
        unit_a = UnitFactory.create(game=game)
        unit_b = UnitFactory.create(game=game)
        make_checkin(unit_a, user, location=LONDON)
        make_checkin(unit_b, user, location=LONDON)

        first = client.get(f"/api/games/{game.id}/leaderboard/?from={unit_a.identifier}").json()
        second = client.get(f"/api/games/{game.id}/leaderboard/?from={unit_b.identifier}").json()

        assert {r["identifier"] for r in first["individual"]} == {unit_a.identifier, None}
        assert {r["identifier"] for r in second["individual"]} == {unit_b.identifier, None}


class TestLeaderboardJourneyDataExclusion:
    def test_leaderboard_response_excludes_journey(self, client, user, db, make_checkin):
        """Journey data lives on the dedicated /journeys/ endpoint now —
        leaderboard rows must not carry it."""
        game = GameFactory.create(mode=Game.Modes.DISTANCE)
        unit = UnitFactory.create(game=game)
        make_checkin(unit, user, location=LONDON)
        make_checkin(unit, user, location=PARIS)

        entry = client.get(f"/api/games/{game.id}/leaderboard/?from={unit.identifier}").json()["individual"][0]
        assert "journey" not in entry


class TestLeaderboardTimeWindow:
    def test_checkins_after_end_time_excluded_from_score(self, client, user, db, make_checkin):
        """Once the game ends, new check-ins must not change the leaderboard."""
        game = GameFactory.create(
            mode=Game.Modes.DISTANCE,
            start_time=timezone.now() - timedelta(days=2),
            allowed_time=24,  # ended ~24h ago
        )
        unit = UnitFactory.create(game=game)
        a = make_checkin(unit, user, location=LONDON)
        CheckIn.objects.filter(pk=a.pk).update(date_created=timezone.now() - timedelta(days=1, hours=12))
        b = make_checkin(unit, user, location=PARIS)
        CheckIn.objects.filter(pk=b.pk).update(date_created=timezone.now() - timedelta(days=1, hours=6))
        # Post-game return to London must NOT count toward score (would
        # roughly double the distance if it leaked in).
        after = make_checkin(unit, user, location=LONDON)
        CheckIn.objects.filter(pk=after.pk).update(date_created=timezone.now())

        row = client.get(f"/api/games/{game.id}/leaderboard/?from={unit.identifier}").json()["individual"][0]
        assert row["checkin_count"] == 2  # noqa: PLR2004
        # London→Paris is ~344 km; round-trip would be ~688.
        assert row["distance_km"] < 400  # noqa: PLR2004

    def test_pre_start_checkins_still_count(self, client, user, db, make_checkin):
        """Per spec: pre-start check-ins are included in leaderboard distance."""
        game = GameFactory.create(
            mode=Game.Modes.DISTANCE,
            start_time=timezone.now() - timedelta(hours=1),  # started 1h ago
        )
        unit = UnitFactory.create(game=game)
        pre = make_checkin(unit, user, location=LONDON)
        CheckIn.objects.filter(pk=pre.pk).update(date_created=timezone.now() - timedelta(days=5))
        make_checkin(unit, user, location=PARIS)  # post-start, in-window

        row = client.get(f"/api/games/{game.id}/leaderboard/?from={unit.identifier}").json()["individual"][0]
        assert row["checkin_count"] == 2  # noqa: PLR2004
        assert row["distance_km"] > 300  # noqa: PLR2004


# ── Journeys ───────────────────────────────────────────────────────────────────


class TestJourneysEndpoint:
    def test_returns_404_for_missing_game(self, client, db):
        assert client.get("/api/games/9999/journeys/").status_code == status.HTTP_404_NOT_FOUND

    def test_returns_200_for_valid_game(self, client, db):
        game = GameFactory.create(mode=Game.Modes.DISTANCE)
        res = client.get(f"/api/games/{game.id}/journeys/")
        assert res.status_code == status.HTTP_200_OK
        assert res.json() == {"game_id": game.id, "journeys": []}

    def test_no_unit_identifiers_in_payload(self, client, user, db, make_checkin):
        """Anti-enumeration: the journeys endpoint never returns slugs."""
        game = GameFactory.create(mode=Game.Modes.DISTANCE)
        unit = UnitFactory.create(game=game)
        make_checkin(unit, user, location=LONDON)

        body = client.get(f"/api/games/{game.id}/journeys/").json()
        for entry in body["journeys"]:
            assert "identifier" not in entry

    def test_journey_returns_ordered_points_with_after_end_flag(self, client, user, db, make_checkin):
        """Each entry includes a chronologically-ordered list of check-in
        coordinates + datetimes. Points dated after `game.end_time` are
        flagged with `after_end=True`."""
        start = timezone.now() - timedelta(hours=10)
        # allowed_time=2h → end_time = start + 2h, so the third check-in below
        # falls outside the game window.
        game = GameFactory.create(mode=Game.Modes.DISTANCE, start_time=start, allowed_time=2)
        unit = UnitFactory.create(game=game)
        in_game_a = make_checkin(unit, user, location=LONDON)
        CheckIn.objects.filter(pk=in_game_a.pk).update(date_created=start + timedelta(minutes=10))
        in_game_b = make_checkin(unit, user, location=PARIS)
        CheckIn.objects.filter(pk=in_game_b.pk).update(date_created=start + timedelta(minutes=90))
        late = make_checkin(unit, user, location=LONDON)
        CheckIn.objects.filter(pk=late.pk).update(date_created=start + timedelta(hours=5))

        journey = client.get(f"/api/games/{game.id}/journeys/").json()["journeys"][0]["journey"]
        assert len(journey) == 3  # noqa: PLR2004
        assert journey[0]["date"] < journey[1]["date"] < journey[2]["date"]
        assert journey[0]["lng"] == pytest.approx(LONDON.x)
        assert journey[0]["lat"] == pytest.approx(LONDON.y)
        assert [p["after_end"] for p in journey] == [False, False, True]

    def test_entries_share_rank_with_leaderboard(self, client, user, db, make_checkin):
        """Map and table must agree on ordering."""
        game = GameFactory.create(mode=Game.Modes.DISTANCE)
        unit_a = UnitFactory.create(game=game)
        unit_b = UnitFactory.create(game=game)
        make_checkin(unit_a, user, location=LONDON)
        make_checkin(unit_a, UserFactory.create(), location=PARIS)
        make_checkin(unit_b, user, location=LONDON)

        leaderboard = client.get(f"/api/games/{game.id}/leaderboard/?from={unit_a.identifier}").json()
        journeys = client.get(f"/api/games/{game.id}/journeys/").json()
        assert journeys["journeys"][0]["rank"] == leaderboard["individual"][0]["rank"]
        assert journeys["journeys"][1]["rank"] == leaderboard["individual"][1]["rank"]
