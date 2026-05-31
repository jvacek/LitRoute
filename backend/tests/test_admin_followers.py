"""Request-layer tests for the bulk follower admin actions.

Covers the project-owned wiring on `UnitAdmin` (select lighters → add/remove
followers) and `UserAdmin` (select users → follow/unfollow lighters). Generic
admin action plumbing is Django's and not re-tested; we assert only on the M2M
mutation and the contributor-visibility guard.
"""

from __future__ import annotations

import pytest
from django.contrib import admin
from django.contrib.admin.helpers import ACTION_CHECKBOX_NAME
from django.contrib.auth.models import Group
from django.urls import reverse
from rest_framework import status

from backend.factories import UnitFactory
from backend.models import Unit
from flamerelay.users.tests.factories import UserFactory

UNIT_CHANGELIST = reverse("admin:backend_unit_changelist")
USER_CHANGELIST = reverse("admin:users_user_changelist")


@pytest.mark.django_db
class TestUnitAdminFollowerActions:
    def test_add_followers_attaches_users_to_each_unit(self, admin_client):
        units = UnitFactory.create_batch(2)
        followers = UserFactory.create_batch(2)

        response = admin_client.post(
            UNIT_CHANGELIST,
            {
                "action": "add_followers",
                ACTION_CHECKBOX_NAME: [u.pk for u in units],
                "apply": "Add followers",
                "followers": [f.pk for f in followers],
            },
        )

        assert response.status_code == status.HTTP_302_FOUND
        for unit in units:
            assert set(unit.followers.values_list("pk", flat=True)) >= {f.pk for f in followers}

    def test_remove_followers_detaches_users(self, admin_client):
        units = UnitFactory.create_batch(2)
        followers = UserFactory.create_batch(2)
        for unit in units:
            unit.followers.add(*followers)

        response = admin_client.post(
            UNIT_CHANGELIST,
            {
                "action": "remove_followers",
                ACTION_CHECKBOX_NAME: [u.pk for u in units],
                "apply": "Remove followers",
                "followers": [f.pk for f in followers],
            },
        )

        assert response.status_code == status.HTTP_302_FOUND
        for unit in units:
            assert not unit.followers.filter(pk__in=[f.pk for f in followers]).exists()

    def test_intermediate_page_renders_without_apply(self, admin_client):
        unit = UnitFactory.create()

        response = admin_client.post(
            UNIT_CHANGELIST,
            {"action": "add_followers", ACTION_CHECKBOX_NAME: [unit.pk]},
        )

        assert response.status_code == status.HTTP_200_OK
        # JS that builds the dual-listbox …
        assert b"SelectFilter2.js" in response.content
        # … and the stylesheet that makes it render correctly (regression guard:
        # base_site.html omits forms.css, so the page must add it explicitly).
        assert b"admin/css/forms.css" in response.content

    def test_contributor_does_not_see_follower_actions(self, rf):
        contributor = UserFactory.create()
        contributor.groups.add(Group.objects.get_or_create(name="contributor")[0])
        request = rf.get(UNIT_CHANGELIST)
        request.user = contributor

        actions = admin.site._registry[Unit].get_actions(request)

        assert "add_followers" not in actions
        assert "remove_followers" not in actions


@pytest.mark.django_db
class TestUserAdminFollowedUnitActions:
    def test_add_makes_users_follow_each_unit(self, admin_client):
        users = UserFactory.create_batch(2)
        units = UnitFactory.create_batch(2)

        response = admin_client.post(
            USER_CHANGELIST,
            {
                "action": "add_followed_units",
                ACTION_CHECKBOX_NAME: [u.pk for u in users],
                "apply": "Follow lighters",
                "units": [unit.pk for unit in units],
            },
        )

        assert response.status_code == status.HTTP_302_FOUND
        for user in users:
            assert set(user.followed_units.values_list("pk", flat=True)) >= {unit.pk for unit in units}

    def test_remove_makes_users_unfollow(self, admin_client):
        users = UserFactory.create_batch(2)
        units = UnitFactory.create_batch(2)
        for user in users:
            user.followed_units.add(*units)

        response = admin_client.post(
            USER_CHANGELIST,
            {
                "action": "remove_followed_units",
                ACTION_CHECKBOX_NAME: [u.pk for u in users],
                "apply": "Unfollow lighters",
                "units": [unit.pk for unit in units],
            },
        )

        assert response.status_code == status.HTTP_302_FOUND
        for user in users:
            assert not user.followed_units.filter(pk__in=[unit.pk for unit in units]).exists()
