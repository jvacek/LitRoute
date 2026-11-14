"""GET /api/stats/ and GET /api/globe-pins/"""

from __future__ import annotations

import pytest
from django.core.cache import cache
from rest_framework import status

from backend.factories import UnitFactory
from backend.tests.conftest import LONDON, PARIS
from config.constants import STATS_CACHE_KEY
from flamerelay.users.tests.factories import UserFactory


class TestStatsView:
    def test_returns_200(self, client, db):
        res = client.get("/api/stats/")
        assert res.status_code == status.HTTP_200_OK

    def test_payload_keys(self, client, db):
        data = client.get("/api/stats/").json()
        assert "active_unit_count" in data
        assert "checkin_count" in data
        assert "followers" in data
        assert "total_distance_traveled_km" in data

    def test_reflects_created_data(self, client, db, make_checkin):
        owner = UserFactory.create()
        unit = UnitFactory.create(admin_only_checkin=False)
        make_checkin(unit, owner, location=LONDON)
        make_checkin(unit, UserFactory.create(), location=PARIS)

        cache.delete(STATS_CACHE_KEY)
        data = client.get("/api/stats/").json()
        assert data["checkin_count"] >= 2  # noqa: PLR2004


class TestGlobePinsView:
    def test_returns_200(self, client, db):
        res = client.get("/api/globe-pins/")
        assert res.status_code == status.HTTP_200_OK

    def test_pins_is_list(self, client, db):
        data = client.get("/api/globe-pins/").json()
        assert isinstance(data["pins"], list)

    def test_ranks_by_distance_not_recency(self, client, clear_cache, make_checkin):
        owner = UserFactory.create()
        travelled = UnitFactory.create()
        make_checkin(travelled, owner, location=PARIS, hours_ago=10)
        make_checkin(travelled, owner, location=LONDON, hours_ago=9)
        idle = UnitFactory.create()
        make_checkin(idle, owner, location=PARIS, hours_ago=2)
        make_checkin(idle, owner, location=PARIS, hours_ago=1)

        pins = client.get("/api/globe-pins/").json()["pins"]

        assert len(pins) == 2  # noqa: PLR2004
        assert pins[0]["lat"] == pytest.approx(LONDON.y)
