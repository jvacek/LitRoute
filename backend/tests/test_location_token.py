from __future__ import annotations

from unittest.mock import patch

import pytest
from django.core import signing

from backend.location_token import _haversine_m, issue_location_claim, verify_location_claim
from config.constants import LOCATION_CLAIM_MAX_DRIFT_METERS, LOCATION_CLAIM_TTL_SECONDS

LAT = 51.5074
LNG = -0.1278
ACCURACY = 10.0
USER_ID = 42


# ---------------------------------------------------------------------------
# Haversine
# ---------------------------------------------------------------------------


class TestHaversine:
    def test_same_point_is_zero(self):
        assert _haversine_m(LAT, LNG, LAT, LNG) == pytest.approx(0.0, abs=1e-6)

    def test_known_distance(self):
        # ~1 degree of latitude ≈ 111 km
        distance = _haversine_m(0.0, 0.0, 1.0, 0.0)
        assert distance == pytest.approx(111_195, rel=0.01)

    def test_symmetry(self):
        assert _haversine_m(LAT, LNG, 51.51, -0.13) == pytest.approx(_haversine_m(51.51, -0.13, LAT, LNG), rel=1e-9)

    def test_small_offset_within_max_drift(self):
        # ~0.003 degrees latitude ≈ 333m, below LOCATION_CLAIM_MAX_DRIFT_METERS
        assert _haversine_m(LAT, LNG, LAT + 0.003, LNG) < LOCATION_CLAIM_MAX_DRIFT_METERS

    def test_small_offset_beyond_max_drift(self):
        # ~0.006 degrees latitude ≈ 666m, above LOCATION_CLAIM_MAX_DRIFT_METERS
        assert _haversine_m(LAT, LNG, LAT + 0.006, LNG) > LOCATION_CLAIM_MAX_DRIFT_METERS


# ---------------------------------------------------------------------------
# issue_location_claim
# ---------------------------------------------------------------------------


class TestIssueLocationClaim:
    def test_returns_string(self):
        token = issue_location_claim(LAT, LNG, ACCURACY, USER_ID)
        assert isinstance(token, str)

    def test_returns_nonempty(self):
        token = issue_location_claim(LAT, LNG, ACCURACY, USER_ID)
        assert len(token) > 0


# ---------------------------------------------------------------------------
# verify_location_claim
# ---------------------------------------------------------------------------


class TestVerifyLocationClaim:
    @pytest.fixture
    def token(self):
        return issue_location_claim(LAT, LNG, ACCURACY, USER_ID)

    def test_exact_coords_passes(self, token):
        verify_location_claim(token, USER_ID, LAT, LNG)  # no exception

    def test_coords_within_max_drift_passes(self, token):
        # shift ~333m north
        verify_location_claim(token, USER_ID, LAT + 0.003, LNG)

    def test_coords_beyond_max_drift_raises(self, token):
        with pytest.raises(ValueError, match="from claimed GPS position"):
            verify_location_claim(token, USER_ID, LAT + 0.006, LNG)

    def test_wrong_user_id_raises(self, token):
        with pytest.raises(ValueError, match="different user"):
            verify_location_claim(token, USER_ID + 1, LAT, LNG)

    def test_tampered_token_raises(self, token):
        bad = token[:-4] + "xxxx"
        with pytest.raises(ValueError, match="Invalid location claim"):
            verify_location_claim(bad, USER_ID, LAT, LNG)

    def test_expired_token_raises(self):
        with patch("time.time", return_value=0.0):
            token = issue_location_claim(LAT, LNG, ACCURACY, USER_ID)

        with (
            patch("time.time", return_value=float(LOCATION_CLAIM_TTL_SECONDS + 1)),
            pytest.raises(ValueError, match="expired"),
        ):
            verify_location_claim(token, USER_ID, LAT, LNG)

    def test_wrong_salt_raises(self):
        bad_token = signing.dumps(
            {"lat": LAT, "lng": LNG, "accuracy": ACCURACY, "user_id": USER_ID},
            salt="wrong",
        )
        with pytest.raises(ValueError, match="Invalid location claim"):
            verify_location_claim(bad_token, USER_ID, LAT, LNG)
