"""Logic-layer tests for `CheckinValidator`'s GPS-mode math.

Verifies the threshold math directly without round-tripping through HTTP.
Wiring into `CheckInViewSet.perform_create` (and the PATCH bypass) is
covered separately at `backend.tests.api.test_location_claim`.
"""

from __future__ import annotations

import pytest
from django.contrib.gis.geos import Point
from geopy.distance import geodesic
from rest_framework.exceptions import ValidationError

from backend.api.views._checkin_helpers import CheckinValidator
from backend.tests.conftest import LONDON, PARIS
from config.constants import CHECKIN_MAX_IMPLIED_SPEED_KMH


def _point_at(origin: Point, *, meters: float, bearing: float = 0.0) -> Point:
    """Return a Point at `meters` from `origin` along `bearing` degrees."""
    dest = geodesic(meters=meters).destination((origin.y, origin.x), bearing=bearing)
    return Point(dest.longitude, dest.latitude)


class TestVerifyGpsDrift:
    """Pin must lie within `max(game.gps_drift_floor, gps_accuracy_m)` of the
    device-reported GPS location."""

    def test_accepts_when_pin_equals_gps(self, gps_unit):
        v = CheckinValidator(gps_unit, request=None, previous=None)
        v.verify_gps_drift({"location": LONDON, "gps_location": LONDON, "gps_accuracy_m": 25})

    def test_accepts_within_game_drift_envelope(self, gps_unit):
        # Pin 300m from GPS, well inside the 500m default drift floor.
        v = CheckinValidator(gps_unit, request=None, previous=None)
        v.verify_gps_drift({"location": _point_at(LONDON, meters=300), "gps_location": LONDON, "gps_accuracy_m": 25})

    def test_accepts_via_accuracy_fallback(self, gps_unit):
        # Pin beyond the drift floor but inside the reported accuracy circle:
        # allowance = max(500, 5000) = 5000m, distance 4000m.
        v = CheckinValidator(gps_unit, request=None, previous=None)
        v.verify_gps_drift({"location": _point_at(LONDON, meters=4000), "gps_location": LONDON, "gps_accuracy_m": 5000})

    def test_rejects_when_pin_beyond_both_envelopes(self, gps_unit):
        # Distance 10km, accuracy 1000m → allowance = max(500, 1000) = 1000m.
        v = CheckinValidator(gps_unit, request=None, previous=None)
        with pytest.raises(ValidationError) as exc:
            v.verify_gps_drift(
                {"location": _point_at(LONDON, meters=10_000), "gps_location": LONDON, "gps_accuracy_m": 1000}
            )
        assert "location" in exc.value.detail

    def test_rejects_when_gps_location_missing(self, gps_unit):
        v = CheckinValidator(gps_unit, request=None, previous=None)
        with pytest.raises(ValidationError) as exc:
            v.verify_gps_drift({"location": LONDON, "gps_accuracy_m": 25})
        assert "gps_location" in exc.value.detail

    def test_rejects_when_gps_accuracy_missing(self, gps_unit):
        v = CheckinValidator(gps_unit, request=None, previous=None)
        with pytest.raises(ValidationError) as exc:
            v.verify_gps_drift({"location": LONDON, "gps_location": LONDON})
        assert "gps_location" in exc.value.detail

    def test_skipped_for_non_game_unit(self, unit):
        # No game attached → is_gps_enforced False → check is a no-op even
        # with a deliberately incomplete payload.
        v = CheckinValidator(unit, request=None, previous=None)
        v.verify_gps_drift({"location": LONDON})


class TestVerifyPreviousCheckinConstraints:
    """Gap + implied-speed checks against the previous check-in on this unit.
    Both live in the same method since they share the `previous` fetch and
    the `unit.is_gps_enforced` gate."""

    def _data(self) -> dict:
        return {"location": LONDON, "gps_location": LONDON, "gps_accuracy_m": 25}

    def test_skipped_when_no_previous(self, gps_unit):
        v = CheckinValidator(gps_unit, request=None, previous=None)
        v.verify_previous_checkin_constraints(self._data())

    def test_rejects_rapid_consecutive_checkin(self, gps_unit, user, make_checkin):
        # Previous "now" → elapsed is microseconds, well under MIN_GAP.
        previous = make_checkin(gps_unit, user, location=LONDON)
        v = CheckinValidator(gps_unit, request=None, previous=previous)
        with pytest.raises(ValidationError) as exc:
            v.verify_previous_checkin_constraints(self._data())
        assert "location" in exc.value.detail

    def test_accepts_after_gap_elapsed(self, gps_unit, user, make_checkin):
        # Previous an hour ago — comfortably past the 60s floor.
        previous = make_checkin(gps_unit, user, location=LONDON, hours_ago=1)
        v = CheckinValidator(gps_unit, request=None, previous=previous)
        v.verify_previous_checkin_constraints(self._data())

    def test_accepts_plausible_speed(self, gps_unit, user, make_checkin):
        # Paris → London (~344km) in 24h: ~14 km/h, well under the cap.
        previous = make_checkin(gps_unit, user, location=PARIS, hours_ago=24)
        v = CheckinValidator(gps_unit, request=None, previous=previous)
        v.verify_previous_checkin_constraints(self._data())

    def test_rejects_implausible_speed(self, gps_unit, user, make_checkin):
        # Previous 1h ago, twice the cap distance away → implied speed = 2x cap.
        far = _point_at(LONDON, meters=int(CHECKIN_MAX_IMPLIED_SPEED_KMH * 1000 * 2))
        previous = make_checkin(gps_unit, user, location=far, hours_ago=1)
        v = CheckinValidator(gps_unit, request=None, previous=previous)
        with pytest.raises(ValidationError) as exc:
            v.verify_previous_checkin_constraints(self._data())
        assert "location" in exc.value.detail

    def test_skipped_for_non_game_unit(self, unit, user, make_checkin):
        # Same implausible setup on a non-game unit: check is a no-op.
        far = _point_at(LONDON, meters=int(CHECKIN_MAX_IMPLIED_SPEED_KMH * 1000 * 2))
        previous = make_checkin(unit, user, location=far)
        v = CheckinValidator(unit, request=None, previous=previous)
        v.verify_previous_checkin_constraints(self._data())
