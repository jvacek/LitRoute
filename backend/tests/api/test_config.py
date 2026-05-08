"""GET /api/config/"""

from __future__ import annotations

from rest_framework import status


class TestConfigView:
    def test_anon_returns_200(self, client, db):
        res = client.get("/api/config/")
        assert res.status_code == status.HTTP_200_OK

    def test_payload_contains_expected_keys(self, client, db):
        data = client.get("/api/config/").json()
        assert "maptilerKey" in data
        assert "allowRegistration" in data
