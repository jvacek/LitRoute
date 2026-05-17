"""POST/DELETE /api/units/<identifier>/follow/"""

from __future__ import annotations

from rest_framework import status


class TestFollowEndpoint:
    def test_anon_follow_returns_401(self, client, unit):
        res = client.post(f"/api/units/{unit.identifier}/follow/")
        assert res.status_code == status.HTTP_401_UNAUTHORIZED

    def test_auth_follow_returns_204(self, auth_client, unit, user):
        res = auth_client.post(f"/api/units/{unit.identifier}/follow/")
        assert res.status_code == status.HTTP_204_NO_CONTENT
        assert unit.followers.filter(pk=user.pk).exists()

    def test_follow_nonexistent_unit_returns_404(self, auth_client, db):
        res = auth_client.post("/api/units/NONE-99/follow/")
        assert res.status_code == status.HTTP_404_NOT_FOUND


class TestUnfollowEndpoint:
    def test_anon_unfollow_returns_401(self, client, unit):
        res = client.delete(f"/api/units/{unit.identifier}/follow/")
        assert res.status_code == status.HTTP_401_UNAUTHORIZED

    def test_auth_unfollow_removes_follow(self, auth_client, unit, user):
        unit.followers.add(user)
        res = auth_client.delete(f"/api/units/{unit.identifier}/follow/")
        assert res.status_code == status.HTTP_204_NO_CONTENT
        assert not unit.followers.filter(pk=user.pk).exists()
