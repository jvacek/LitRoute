"""Wiring smoke tests for `CheckinValidator` → `CheckInViewSet.perform_create`.

The math/threshold cases for GPS drift, implied speed, and the min-gap floor
live as logic-layer tests at `backend.tests.test_checkin_validator`. This
file only verifies the integration: that validator failures surface as HTTP
400 from POST, the happy path returns 201, and PATCH does NOT trigger the
create-time validator.
"""

from __future__ import annotations

from rest_framework import status

from backend.tests.conftest import LONDON, LONDON_PAYLOAD


class TestValidatorWiring:
    def test_valid_gps_payload_returns_201(self, auth_client, gps_unit, mute_emails):
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

    def test_missing_gps_payload_returns_400(self, auth_client, gps_unit, mute_emails):
        # Drives `CheckinValidator.verify_gps_drift` to raise; verifies the
        # failure becomes an HTTP 400 with a field-shaped error.
        res = auth_client.post(
            f"/api/units/{gps_unit.identifier}/checkins/",
            {"location": LONDON_PAYLOAD, "place": "London Bridge"},
            format="json",
        )
        assert res.status_code == status.HTTP_400_BAD_REQUEST
        assert "gps_location" in res.json()

    def test_patch_does_not_require_gps_payload(self, auth_client, gps_unit, user, make_checkin):
        """PATCH goes through `perform_update`, not `perform_create`, so the
        create-time validator never runs — editing a check-in without a GPS
        payload must NOT 400."""
        checkin = make_checkin(gps_unit, user, location=LONDON)
        res = auth_client.patch(
            f"/api/units/{gps_unit.identifier}/checkins/{checkin.pk}/",
            {"message": "updated"},
        )
        assert res.status_code == status.HTTP_200_OK
