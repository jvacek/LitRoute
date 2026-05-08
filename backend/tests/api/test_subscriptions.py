"""POST/DELETE /api/units/<identifier>/subscribe/"""

from __future__ import annotations

from rest_framework import status


class TestSubscribeEndpoint:
    def test_anon_subscribe_returns_401(self, client, unit):
        res = client.post(f"/api/units/{unit.identifier}/subscribe/")
        assert res.status_code == status.HTTP_401_UNAUTHORIZED

    def test_auth_subscribe_returns_204(self, auth_client, unit, user):
        res = auth_client.post(f"/api/units/{unit.identifier}/subscribe/")
        assert res.status_code == status.HTTP_204_NO_CONTENT
        assert unit.subscribers.filter(pk=user.pk).exists()

    def test_subscribe_nonexistent_unit_returns_404(self, auth_client, db):
        res = auth_client.post("/api/units/NONE-99/subscribe/")
        assert res.status_code == status.HTTP_404_NOT_FOUND


class TestUnsubscribeEndpoint:
    def test_anon_unsubscribe_returns_401(self, client, unit):
        res = client.delete(f"/api/units/{unit.identifier}/subscribe/")
        assert res.status_code == status.HTTP_401_UNAUTHORIZED

    def test_auth_unsubscribe_removes_subscription(self, auth_client, unit, user):
        unit.subscribers.add(user)
        res = auth_client.delete(f"/api/units/{unit.identifier}/subscribe/")
        assert res.status_code == status.HTTP_204_NO_CONTENT
        assert not unit.subscribers.filter(pk=user.pk).exists()
