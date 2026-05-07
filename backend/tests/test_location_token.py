from __future__ import annotations

from unittest.mock import patch

import pytest
from django.core import signing
from django.core.cache import cache

from backend.location_token import _haversine_m, issue_location_claim, verify_location_claim
from config.constants import LOCATION_CLAIM_MAX_ACCURACY_METERS, LOCATION_CLAIM_TTL_SECONDS

LAT = 51.5074
LNG = -0.1278
ACCURACY = 10.0
USER_ID = 42
UNIT = "unit-a"


@pytest.fixture(autouse=True)
def _clear_cache():
    cache.clear()
    yield
    cache.clear()


class TestHaversine:
    def test_same_point_is_zero(self):
        assert _haversine_m(LAT, LNG, LAT, LNG) == pytest.approx(0.0, abs=1e-6)

    def test_known_distance(self):
        # ~1 degree of latitude ≈ 111 km
        assert _haversine_m(0.0, 0.0, 1.0, 0.0) == pytest.approx(111_195, rel=0.01)

    def test_symmetry(self):
        assert _haversine_m(LAT, LNG, 51.51, -0.13) == pytest.approx(_haversine_m(51.51, -0.13, LAT, LNG), rel=1e-9)

    def test_antipodal_does_not_raise(self):
        # FP error can push sqrt(a) above 1 for near-antipodal points; the
        # clamp must keep asin in domain. Expected ≈ π · earth_radius.
        d = _haversine_m(0.0, 0.0, 0.0, 180.0)
        assert d == pytest.approx(20_015_000, rel=0.01)


class TestIssueLocationClaim:
    @pytest.fixture
    def token(self):
        return issue_location_claim(LAT, LNG, ACCURACY, USER_ID, unit_identifier=UNIT)

    def test_returns_string(self, token):
        assert isinstance(token, str)

    def test_returns_nonempty(self, token):
        assert len(token) > 0

    def test_accuracy_above_threshold_raises(self):
        with pytest.raises(ValueError, match="GPS accuracy too low"):
            issue_location_claim(LAT, LNG, LOCATION_CLAIM_MAX_ACCURACY_METERS + 1, USER_ID, unit_identifier=UNIT)

    def test_accuracy_at_threshold_passes(self):
        token = issue_location_claim(LAT, LNG, LOCATION_CLAIM_MAX_ACCURACY_METERS, USER_ID, unit_identifier=UNIT)
        assert isinstance(token, str)


class TestVerifyLocationClaim:
    @pytest.fixture
    def token(self):
        return issue_location_claim(LAT, LNG, ACCURACY, USER_ID, unit_identifier=UNIT)

    def test_exact_coords_passes(self, token):
        verify_location_claim(token, USER_ID, UNIT, LAT, LNG)  # no exception

    def test_coords_within_max_drift_passes(self, token):
        # shift ~333m north
        verify_location_claim(token, USER_ID, UNIT, LAT + 0.003, LNG)

    def test_coords_beyond_max_drift_raises(self, token):
        with pytest.raises(ValueError, match="from claimed GPS position"):
            verify_location_claim(token, USER_ID, UNIT, LAT + 0.006, LNG)

    def test_wrong_user_id_raises(self, token):
        with pytest.raises(ValueError, match="different user"):
            verify_location_claim(token, USER_ID + 1, UNIT, LAT, LNG)

    def test_anon_token_passes_with_none_user_id(self):
        token = issue_location_claim(LAT, LNG, ACCURACY, None, unit_identifier=UNIT)
        verify_location_claim(token, None, UNIT, LAT, LNG)  # no exception

    def test_anon_token_rejected_for_authed_user(self):
        token = issue_location_claim(LAT, LNG, ACCURACY, None, unit_identifier=UNIT)
        with pytest.raises(ValueError, match="different user"):
            verify_location_claim(token, USER_ID, UNIT, LAT, LNG)

    def test_authed_token_rejected_for_anon(self):
        token = issue_location_claim(LAT, LNG, ACCURACY, USER_ID, unit_identifier=UNIT)
        with pytest.raises(ValueError, match="different user"):
            verify_location_claim(token, None, UNIT, LAT, LNG)

    def test_tampered_token_raises(self, token):
        bad = token[:-4] + "xxxx"
        with pytest.raises(ValueError, match="Invalid location claim"):
            verify_location_claim(bad, USER_ID, UNIT, LAT, LNG)

    def test_expired_token_raises(self):
        with patch("time.time", return_value=0.0):
            token = issue_location_claim(LAT, LNG, ACCURACY, USER_ID, unit_identifier=UNIT)

        with (
            patch("time.time", return_value=float(LOCATION_CLAIM_TTL_SECONDS + 1)),
            pytest.raises(ValueError, match="expired"),
        ):
            verify_location_claim(token, USER_ID, UNIT, LAT, LNG)

    def test_wrong_salt_raises(self):
        bad_token = signing.dumps(
            {"lat": LAT, "lng": LNG, "accuracy": ACCURACY, "user_id": USER_ID, "unit_identifier": UNIT},
            salt="wrong",
        )
        with pytest.raises(ValueError, match="Invalid location claim"):
            verify_location_claim(bad_token, USER_ID, UNIT, LAT, LNG)

    def test_unit_mismatch_raises(self, token):
        with pytest.raises(ValueError, match="different unit"):
            verify_location_claim(token, USER_ID, "unit-b", LAT, LNG)

    def test_replay_raises(self, token):
        verify_location_claim(token, USER_ID, UNIT, LAT, LNG)  # first use succeeds
        with pytest.raises(ValueError, match="already used"):
            verify_location_claim(token, USER_ID, UNIT, LAT, LNG)

    def test_failed_verify_does_not_consume_token(self, token):
        # Wrong user fails — token must remain usable for the legitimate caller
        with pytest.raises(ValueError, match="different user"):
            verify_location_claim(token, USER_ID + 1, UNIT, LAT, LNG)
        # Same token now passes for the rightful user
        verify_location_claim(token, USER_ID, UNIT, LAT, LNG)
