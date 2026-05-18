"""Logic-layer tests for distance computation.

Stresses the raw SQL in `Unit.objects.with_distance_km()` (PostGIS
`ST_MakeLine` + `ST_Length(geography)`) and the cache coordination in
`total_distance_traveled_in_km` / `Unit.get_distance_traveled` that wraps it.

Reference distances (geopy.geodesic, WGS-84):
    LONDON -> PARIS  ≈ 343.55 km
    LONDON -> ROME   ≈ 1430.4 km
    PARIS  -> ROME   ≈ 1105.5 km
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest
from django.contrib.gis.geos import Point
from django.core.cache import cache

from backend.factories import UnitFactory
from backend.models import Unit
from backend.services import (
    total_distance_traveled_in_km,
    unit_distance_cache_key,
)
from backend.tests.conftest import LONDON, PARIS
from config.constants import EXAMPLE_IDENTIFIER
from flamerelay.users.tests.factories import UserFactory

if TYPE_CHECKING:
    from backend.models.unit import UnitQuerySet

ROME = Point(12.4964, 41.9028)
LONDON_PARIS_KM = 343.55
LONDON_PARIS_ROME_KM = 1449.05  # LONDON→PARIS→ROME path total
# Generous tolerance for PostGIS spheroid vs geopy Karney rounding (both WGS-84).
KM_TOLERANCE = 0.5
# Wider tolerance for the 3-segment path (errors accumulate).
KM_TOLERANCE_MULTI = 5.0


def _distances(qs: UnitQuerySet) -> dict[int, float]:
    """Test helper: collapse `.with_distance_km()` into a {pk: km} map."""
    return {u.pk: u.distance_km for u in qs.with_distance_km()}


@pytest.fixture(autouse=True)
def _isolate_cache(clear_cache):
    """Every test in this module touches `unit:distance:*` keys."""


class TestWithDistanceKm:
    def test_empty_queryset(self, db):
        assert _distances(Unit.objects.none()) == {}

    def test_unit_with_no_checkins_is_zero(self, unit):
        assert _distances(Unit.objects.filter(pk=unit.pk)) == {unit.pk: 0.0}

    def test_unit_with_one_checkin_is_zero(self, unit, make_checkin):
        """A single point cannot form a LineString; `ST_MakeLine` returns NULL
        and the `COALESCE` in the annotation defaults to 0.0."""
        make_checkin(unit, UserFactory.create(), location=LONDON)
        assert _distances(Unit.objects.filter(pk=unit.pk)) == {unit.pk: 0.0}

    def test_two_checkins_matches_geodesic(self, unit, make_checkin):
        make_checkin(unit, UserFactory.create(), location=LONDON, hours_ago=24)
        make_checkin(unit, UserFactory.create(), location=PARIS, hours_ago=0)
        km = _distances(Unit.objects.filter(pk=unit.pk))[unit.pk]
        assert abs(km - LONDON_PARIS_KM) < KM_TOLERANCE

    def test_identical_consecutive_points_are_zero(self, unit, make_checkin):
        make_checkin(unit, UserFactory.create(), location=LONDON, hours_ago=24)
        make_checkin(unit, UserFactory.create(), location=LONDON, hours_ago=0)
        assert _distances(Unit.objects.filter(pk=unit.pk))[unit.pk] == 0.0

    def test_orders_by_date_created_not_insert_order(self, unit, make_checkin):
        """Insert order vs chronological order yields different path lengths.

        Insert order (by id) → PARIS, ROME, LONDON ≈ 2536 km.
        date_created order   → LONDON, PARIS, ROME ≈ 1449 km.
        Asserting 1449 ± a few km confirms `ORDER BY date_created` inside
        `ST_MakeLine` is doing its job. Without it this test fails by ~1100km.
        """
        make_checkin(unit, UserFactory.create(), location=PARIS, hours_ago=24)
        make_checkin(unit, UserFactory.create(), location=ROME, hours_ago=0)
        make_checkin(unit, UserFactory.create(), location=LONDON, hours_ago=48)

        km = _distances(Unit.objects.filter(pk=unit.pk))[unit.pk]
        assert abs(km - LONDON_PARIS_ROME_KM) < KM_TOLERANCE_MULTI

    def test_multi_unit(self, db, make_checkin):
        u1 = UnitFactory.create()
        u2 = UnitFactory.create()
        make_checkin(u1, UserFactory.create(), location=LONDON, hours_ago=24)
        make_checkin(u1, UserFactory.create(), location=PARIS, hours_ago=0)
        make_checkin(u2, UserFactory.create(), location=LONDON)

        result = _distances(Unit.objects.filter(pk__in=[u1.pk, u2.pk]))
        assert set(result) == {u1.pk, u2.pk}
        assert abs(result[u1.pk] - LONDON_PARIS_KM) < KM_TOLERANCE
        assert result[u2.pk] == 0.0

    def test_excluded_units_do_not_leak(self, db, make_checkin):
        """A unit outside the filtered queryset must not contribute to anyone
        else's distance — the correlated subquery only counts THIS unit's rows."""
        u_in = UnitFactory.create()
        u_out = UnitFactory.create()
        make_checkin(u_in, UserFactory.create(), location=LONDON, hours_ago=24)
        make_checkin(u_in, UserFactory.create(), location=PARIS, hours_ago=0)
        make_checkin(u_out, UserFactory.create(), location=LONDON, hours_ago=48)
        make_checkin(u_out, UserFactory.create(), location=ROME, hours_ago=0)

        result = _distances(Unit.objects.filter(pk=u_in.pk))
        assert set(result) == {u_in.pk}
        assert abs(result[u_in.pk] - LONDON_PARIS_KM) < KM_TOLERANCE

    def test_chains_with_filter_and_order_by(self, db, make_checkin):
        """The annotation composes with the rest of the queryset API —
        unlocks `order_by('-distance_km')` and `filter(distance_km__gt=...)`."""
        far = UnitFactory.create()
        near = UnitFactory.create()
        make_checkin(far, UserFactory.create(), location=LONDON, hours_ago=48)
        make_checkin(far, UserFactory.create(), location=ROME, hours_ago=0)
        make_checkin(near, UserFactory.create(), location=LONDON, hours_ago=24)
        make_checkin(near, UserFactory.create(), location=PARIS, hours_ago=0)

        ranked = list(Unit.objects.with_distance_km().order_by("-distance_km"))
        assert [u.pk for u in ranked[:2]] == [far.pk, near.pk]


class TestTotalDistanceTraveledInKm:
    def test_zero_when_no_data(self, db):
        assert total_distance_traveled_in_km() == 0.0

    def test_sums_across_units(self, db, make_checkin):
        u1 = UnitFactory.create()
        u2 = UnitFactory.create()
        for u in (u1, u2):
            make_checkin(u, UserFactory.create(), location=LONDON, hours_ago=24)
            make_checkin(u, UserFactory.create(), location=PARIS, hours_ago=0)

        assert abs(total_distance_traveled_in_km() - 2 * LONDON_PARIS_KM) < KM_TOLERANCE * 2

    def test_excludes_example_identifier(self, db, make_checkin):
        example = UnitFactory.create(identifier=EXAMPLE_IDENTIFIER)
        real = UnitFactory.create()
        for u in (example, real):
            make_checkin(u, UserFactory.create(), location=LONDON, hours_ago=24)
            make_checkin(u, UserFactory.create(), location=PARIS, hours_ago=0)

        assert abs(total_distance_traveled_in_km() - LONDON_PARIS_KM) < KM_TOLERANCE

    def test_mixes_warm_and_cold_units(self, db, make_checkin):
        """Cached units skip the SQL; cache-miss units go through it in one
        grouped query. Both code paths in one test — the only cache behavior
        that's our logic rather than Django's `cache.get`/`set` round-trip.

        The warm sentinel (50km) is well outside what the LONDON→PARIS path
        could produce (~343km), so the assertion can only pass if both
        branches ran correctly: the warm unit's value came from cache, the
        cold unit's value came from SQL, and the cold value was written through.
        """
        u_warm = UnitFactory.create()
        u_cold = UnitFactory.create()
        for u in (u_warm, u_cold):
            make_checkin(u, UserFactory.create(), location=LONDON, hours_ago=24)
            make_checkin(u, UserFactory.create(), location=PARIS, hours_ago=0)
        warm_sentinel = 50.0
        cache.set(unit_distance_cache_key(u_warm.identifier), warm_sentinel, 60)
        cache.delete(unit_distance_cache_key(u_cold.identifier))

        total = total_distance_traveled_in_km()
        assert abs(total - (warm_sentinel + LONDON_PARIS_KM)) < KM_TOLERANCE
        assert abs(cache.get(unit_distance_cache_key(u_cold.identifier)) - LONDON_PARIS_KM) < KM_TOLERANCE
