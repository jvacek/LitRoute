"""GPS-enforced check-in creation: drift envelope and impossible-speed checks.

These live in `backend.api.views.CheckInViewSet._verify_gps_drift` and
`_verify_implied_speed`. Both run before the row is saved, so failures are
visible as 400 responses with field-shaped error payloads.
"""

from __future__ import annotations

from django.contrib.gis.geos import Point
from geopy.distance import geodesic
from rest_framework import status

from backend.tests.conftest import LONDON, LONDON_PAYLOAD, PARIS
from config.constants import CHECKIN_MAX_IMPLIED_SPEED_KMH


def _point_at(origin: Point, *, meters: float, bearing: float = 0.0) -> Point:
    """Return a Point at `meters` from `origin` along `bearing` degrees."""
    dest = geodesic(meters=meters).destination((origin.y, origin.x), bearing=bearing)
    return Point(dest.longitude, dest.latitude)


def _payload(p: Point) -> dict:
    return {"type": "Point", "coordinates": [p.x, p.y]}


class TestDriftValidation:
    """`_verify_gps_drift` — pin must lie within max(game.gps_drift_floor, accuracy_m)
    of the device-reported GPS location, otherwise 400."""

    def test_accepts_when_pin_equals_gps(self, auth_client, gps_unit, mute_emails):
        res = auth_client.post(
            f"/api/units/{gps_unit.identifier}/checkins/",
            {
                "location": LONDON_PAYLOAD,
                "gps_location": LONDON_PAYLOAD,
                "gps_accuracy_m": 25,
                "place": "London Bridge",
            },
            format="json",
        )
        assert res.status_code == status.HTTP_201_CREATED

    def test_accepts_within_game_drift_envelope(self, auth_client, gps_unit, mute_emails):
        # Pin 300m from GPS, well inside the 500m default game drift floor.
        nudged = _point_at(LONDON, meters=300)
        res = auth_client.post(
            f"/api/units/{gps_unit.identifier}/checkins/",
            {
                "location": _payload(nudged),
                "gps_location": LONDON_PAYLOAD,
                "gps_accuracy_m": 25,
                "place": "London Bridge",
            },
            format="json",
        )
        assert res.status_code == status.HTTP_201_CREATED

    def test_accepts_via_accuracy_fallback(self, auth_client, gps_unit, mute_emails):
        # Pin beyond the game drift floor but inside the user's reported
        # accuracy circle: max(500, 5000) = 5000m allowance, distance 4000m.
        nudged = _point_at(LONDON, meters=4000)
        res = auth_client.post(
            f"/api/units/{gps_unit.identifier}/checkins/",
            {
                "location": _payload(nudged),
                "gps_location": LONDON_PAYLOAD,
                "gps_accuracy_m": 5000,
                "place": "London Bridge",
            },
            format="json",
        )
        assert res.status_code == status.HTTP_201_CREATED

    def test_rejects_when_pin_beyond_both_envelopes(self, auth_client, gps_unit, mute_emails):
        # Distance 10km, accuracy 1000m → allowance = max(500, 1000) = 1000m.
        nudged = _point_at(LONDON, meters=10_000)
        res = auth_client.post(
            f"/api/units/{gps_unit.identifier}/checkins/",
            {
                "location": _payload(nudged),
                "gps_location": LONDON_PAYLOAD,
                "gps_accuracy_m": 1000,
                "place": "London Bridge",
            },
            format="json",
        )
        assert res.status_code == status.HTTP_400_BAD_REQUEST
        assert "location" in res.json()

    def test_rejects_when_gps_location_missing(self, auth_client, gps_unit, mute_emails):
        res = auth_client.post(
            f"/api/units/{gps_unit.identifier}/checkins/",
            {"location": LONDON_PAYLOAD, "gps_accuracy_m": 25, "place": "London Bridge"},
            format="json",
        )
        assert res.status_code == status.HTTP_400_BAD_REQUEST
        assert "gps_location" in res.json()

    def test_rejects_when_gps_accuracy_missing(self, auth_client, gps_unit, mute_emails):
        res = auth_client.post(
            f"/api/units/{gps_unit.identifier}/checkins/",
            {"location": LONDON_PAYLOAD, "gps_location": LONDON_PAYLOAD, "place": "London Bridge"},
            format="json",
        )
        assert res.status_code == status.HTTP_400_BAD_REQUEST
        assert "gps_location" in res.json()

    def test_non_game_unit_does_not_require_gps_payload(self, auth_client, unit, mute_emails):
        # `unit` is the default UnitFactory with no Game attached.
        res = auth_client.post(
            f"/api/units/{unit.identifier}/checkins/",
            {"location": LONDON_PAYLOAD},
            format="json",
        )
        assert res.status_code == status.HTTP_201_CREATED


class TestImpliedSpeedValidation:
    """`_verify_implied_speed` — pin-to-previous-pin distance ÷ time since last
    check-in must stay under `CHECKIN_MAX_IMPLIED_SPEED_KMH`. Scoped to
    game-mode units only; non-game flows are unconstrained."""

    def _game_payload(self) -> dict:
        return {
            "location": LONDON_PAYLOAD,
            "gps_location": LONDON_PAYLOAD,
            "gps_accuracy_m": 25,
            "place": "London Bridge",
        }

    def test_accepts_first_checkin_with_no_prior(self, auth_client, gps_unit, mute_emails):
        res = auth_client.post(
            f"/api/units/{gps_unit.identifier}/checkins/",
            self._game_payload(),
            format="json",
        )
        assert res.status_code == status.HTTP_201_CREATED

    def test_accepts_plausible_speed(self, auth_client, gps_unit, user, make_checkin, mute_emails):
        # Paris → London (~344km) with 24h since previous check-in: ~14 km/h.
        make_checkin(gps_unit, user, location=PARIS, hours_ago=24)
        res = auth_client.post(
            f"/api/units/{gps_unit.identifier}/checkins/",
            self._game_payload(),
            format="json",
        )
        assert res.status_code == status.HTTP_201_CREATED

    def test_rejects_implausible_speed(self, auth_client, gps_unit, user, make_checkin, mute_emails):
        # Previous check-in 1h ago, twice the speed-cap distance away → implied
        # speed = 2 * CHECKIN_MAX_IMPLIED_SPEED_KMH, comfortably over the cap.
        far_origin = _point_at(LONDON, meters=int(CHECKIN_MAX_IMPLIED_SPEED_KMH * 1000 * 2))
        make_checkin(gps_unit, user, location=far_origin, hours_ago=1)
        res = auth_client.post(
            f"/api/units/{gps_unit.identifier}/checkins/",
            self._game_payload(),
            format="json",
        )
        assert res.status_code == status.HTTP_400_BAD_REQUEST
        assert "location" in res.json()

    def test_skipped_for_non_game_unit(self, auth_client, unit, user, make_checkin, mute_emails):
        # Same implausible setup but on a non-game unit — should be accepted
        # because the speed check is scoped to GPS-enforced games.
        far_origin = _point_at(LONDON, meters=int(CHECKIN_MAX_IMPLIED_SPEED_KMH * 1000 * 2))
        make_checkin(unit, user, location=far_origin, hours_ago=1)
        res = auth_client.post(
            f"/api/units/{unit.identifier}/checkins/",
            {"location": LONDON_PAYLOAD},
            format="json",
        )
        assert res.status_code == status.HTTP_201_CREATED


class TestCheckinGapValidation:
    """`_verify_checkin_gap` — game-mode units require a minimum gap between
    consecutive check-ins. Acts as anti-spam and as the floor that keeps the
    implied-speed check well-conditioned. Non-game flows are unconstrained."""

    def _game_payload(self) -> dict:
        return {
            "location": LONDON_PAYLOAD,
            "gps_location": LONDON_PAYLOAD,
            "gps_accuracy_m": 25,
            "place": "London Bridge",
        }

    def test_rejects_rapid_consecutive_checkin(self, auth_client, gps_unit, user, make_checkin, mute_emails):
        # Previous check-in created "now" (hours_ago=0) → elapsed is
        # microseconds, well under the minimum gap.
        make_checkin(gps_unit, user, location=LONDON)
        res = auth_client.post(
            f"/api/units/{gps_unit.identifier}/checkins/",
            self._game_payload(),
            format="json",
        )
        assert res.status_code == status.HTTP_400_BAD_REQUEST
        assert "location" in res.json()

    def test_accepts_first_checkin_with_no_prior(self, auth_client, gps_unit, mute_emails):
        res = auth_client.post(
            f"/api/units/{gps_unit.identifier}/checkins/",
            self._game_payload(),
            format="json",
        )
        assert res.status_code == status.HTTP_201_CREATED

    def test_accepts_after_gap_elapsed(self, auth_client, gps_unit, user, make_checkin, mute_emails):
        # Previous check-in an hour ago — comfortably past the 60s floor.
        make_checkin(gps_unit, user, location=LONDON, hours_ago=1)
        res = auth_client.post(
            f"/api/units/{gps_unit.identifier}/checkins/",
            self._game_payload(),
            format="json",
        )
        assert res.status_code == status.HTTP_201_CREATED

    def test_skipped_for_non_game_unit(self, auth_client, unit, user, make_checkin, mute_emails):
        # Rapid consecutive check-ins on a non-game unit are allowed — the
        # gap rule is scoped to GPS-enforced games.
        make_checkin(unit, user, location=LONDON)
        res = auth_client.post(
            f"/api/units/{unit.identifier}/checkins/",
            {"location": LONDON_PAYLOAD},
            format="json",
        )
        assert res.status_code == status.HTTP_201_CREATED


class TestDriftValidationDoesNotApplyToEdits:
    """The drift validator runs from `perform_create` only — PATCH goes through
    `perform_update`, so editing a check-in never trips it even without a GPS
    payload. (Location itself is also immutable on edit, enforced separately
    in `partial_update`.)"""

    def test_edit_without_gps_payload_does_not_400(self, auth_client, gps_unit, user, make_checkin):
        checkin = make_checkin(gps_unit, user, location=LONDON)
        res = auth_client.patch(
            f"/api/units/{gps_unit.identifier}/checkins/{checkin.pk}/",
            {"message": "updated"},
        )
        assert res.status_code == status.HTTP_200_OK
