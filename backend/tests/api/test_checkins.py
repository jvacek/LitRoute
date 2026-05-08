"""CheckIn API: list, create (with permission rules), partial update, destroy.

Anonymous-checkin flows live in `test_anonymous_checkins.py`. GPS-enforced
flows live in `test_location_claim.py`.
"""

from __future__ import annotations

from rest_framework import status

from backend.factories import UnitFactory
from backend.models import CheckIn
from backend.tests.conftest import LONDON, LONDON_PAYLOAD
from config.constants import CHECKIN_DELETE_GRACE_PERIOD_HOURS, CHECKIN_EDIT_GRACE_PERIOD_HOURS
from flamerelay.users.tests.factories import UserFactory


class TestCheckInList:
    def test_anon_can_list(self, client, unit):
        res = client.get(f"/api/units/{unit.identifier}/checkins/")
        assert res.status_code == status.HTTP_200_OK

    def test_returns_checkins_for_unit(self, client, unit, user, make_checkin):
        make_checkin(unit, user)
        assert len(client.get(f"/api/units/{unit.identifier}/checkins/").json()) >= 1

    def test_does_not_return_checkins_from_other_unit(self, client, db, make_checkin):
        unit_a = UnitFactory.create()
        unit_b = UnitFactory.create()
        make_checkin(unit_b, UserFactory.create())
        assert client.get(f"/api/units/{unit_a.identifier}/checkins/").json() == []


class TestCheckInCreate:
    """Permission rules for POST /api/units/<id>/checkins/.

    Logic-layer counterpart: `backend.tests.test_unit_model.TestCanUserCheckIn`.
    """

    def test_first_checkin_returns_201(self, auth_client, unit, mute_emails):
        res = auth_client.post(
            f"/api/units/{unit.identifier}/checkins/",
            {"location": LONDON_PAYLOAD},
            format="json",
        )
        assert res.status_code == status.HTTP_201_CREATED

    def test_current_holder_can_check_in_again(self, auth_client, unit, user, make_checkin, mute_emails):
        make_checkin(unit, user)
        res = auth_client.post(
            f"/api/units/{unit.identifier}/checkins/",
            {"location": LONDON_PAYLOAD},
            format="json",
        )
        assert res.status_code == status.HTTP_201_CREATED

    def test_past_holder_blocked_after_handoff(self, client, unit, make_checkin, mute_emails):
        user_a = UserFactory.create()
        user_b = UserFactory.create()
        make_checkin(unit, user_a)
        make_checkin(unit, user_b)

        client.force_authenticate(user=user_a)
        res = client.post(
            f"/api/units/{unit.identifier}/checkins/",
            {"location": LONDON_PAYLOAD, "message": "sneaky"},
            format="json",
        )
        assert res.status_code == status.HTTP_403_FORBIDDEN

    def test_new_user_can_check_in_after_handoff(self, client, unit, make_checkin, mute_emails):
        make_checkin(unit, UserFactory.create())
        client.force_authenticate(user=UserFactory.create())
        res = client.post(
            f"/api/units/{unit.identifier}/checkins/",
            {"location": LONDON_PAYLOAD},
            format="json",
        )
        assert res.status_code == status.HTTP_201_CREATED

    def test_superuser_past_holder_can_still_check_in(self, client, unit, make_checkin, mute_emails):
        superuser = UserFactory.create(is_superuser=True)
        other = UserFactory.create()
        make_checkin(unit, superuser)
        make_checkin(unit, other)

        client.force_authenticate(user=superuser)
        res = client.post(
            f"/api/units/{unit.identifier}/checkins/",
            {"location": LONDON_PAYLOAD},
            format="json",
        )
        assert res.status_code == status.HTTP_201_CREATED

    def test_authenticated_response_does_not_expose_edit_token(self, auth_client, unit, mute_emails):
        res = auth_client.post(
            f"/api/units/{unit.identifier}/checkins/",
            {"location": LONDON_PAYLOAD},
            format="json",
        )
        assert res.status_code == status.HTTP_201_CREATED
        assert "edit_token" not in res.json()


class TestCheckInPartialUpdate:
    def test_owner_can_edit_within_grace_period(self, auth_client, unit, user, make_checkin):
        checkin = make_checkin(unit, user)
        res = auth_client.patch(
            f"/api/units/{unit.identifier}/checkins/{checkin.pk}/",
            {"message": "updated"},
        )
        assert res.status_code == status.HTTP_200_OK

    def test_non_owner_gets_403(self, auth_client, unit, make_checkin):
        owner = UserFactory.create()
        checkin = make_checkin(unit, owner)
        res = auth_client.patch(
            f"/api/units/{unit.identifier}/checkins/{checkin.pk}/",
            {"message": "sneaky edit"},
        )
        assert res.status_code == status.HTTP_403_FORBIDDEN

    def test_owner_blocked_after_grace_period(self, auth_client, unit, user, make_checkin):
        checkin = make_checkin(unit, user, hours_ago=CHECKIN_EDIT_GRACE_PERIOD_HOURS + 1)
        res = auth_client.patch(
            f"/api/units/{unit.identifier}/checkins/{checkin.pk}/",
            {"message": "too late"},
        )
        assert res.status_code == status.HTTP_403_FORBIDDEN

    def test_anon_gets_403(self, client, unit, user, make_checkin):
        checkin = make_checkin(unit, user)
        res = client.patch(
            f"/api/units/{unit.identifier}/checkins/{checkin.pk}/",
            {"message": "anon edit"},
        )
        assert res.status_code == status.HTTP_403_FORBIDDEN

    def test_location_patch_returns_400(self, auth_client, unit, user, make_checkin):
        checkin = make_checkin(unit, user, location=LONDON)
        paris_payload = {"type": "Point", "coordinates": [2.3522, 48.8566]}
        res = auth_client.patch(
            f"/api/units/{unit.identifier}/checkins/{checkin.pk}/",
            {"location": paris_payload},
            format="json",
        )
        assert res.status_code == status.HTTP_400_BAD_REQUEST
        assert "location" in res.json()


class TestCheckInDestroy:
    def test_owner_can_delete_within_grace_period(self, auth_client, unit, user, make_checkin):
        checkin = make_checkin(unit, user)
        res = auth_client.delete(f"/api/units/{unit.identifier}/checkins/{checkin.pk}/")
        assert res.status_code == status.HTTP_204_NO_CONTENT
        assert not CheckIn.objects.filter(pk=checkin.pk).exists()

    def test_non_owner_gets_403(self, auth_client, unit, make_checkin):
        checkin = make_checkin(unit, UserFactory.create())
        res = auth_client.delete(f"/api/units/{unit.identifier}/checkins/{checkin.pk}/")
        assert res.status_code == status.HTTP_403_FORBIDDEN

    def test_owner_blocked_after_grace_period(self, auth_client, unit, user, make_checkin):
        checkin = make_checkin(unit, user, hours_ago=CHECKIN_DELETE_GRACE_PERIOD_HOURS + 1)
        res = auth_client.delete(f"/api/units/{unit.identifier}/checkins/{checkin.pk}/")
        assert res.status_code == status.HTTP_403_FORBIDDEN

    def test_anon_gets_403(self, client, unit, user, make_checkin):
        checkin = make_checkin(unit, user)
        res = client.delete(f"/api/units/{unit.identifier}/checkins/{checkin.pk}/")
        assert res.status_code == status.HTTP_403_FORBIDDEN


class TestCheckInMessageValidation:
    def test_url_in_message_on_create_surfaces_as_field_error(self, auth_client, unit, mute_emails):
        res = auth_client.post(
            f"/api/units/{unit.identifier}/checkins/",
            {"location": LONDON_PAYLOAD, "message": "https://spam.com"},
            format="json",
        )
        assert res.status_code == status.HTTP_400_BAD_REQUEST
        data = res.json()
        assert "message" in data
        assert "non_field_errors" not in data

    def test_url_in_message_on_edit_surfaces_as_field_error(self, auth_client, unit, user, make_checkin):
        checkin = make_checkin(unit, user)
        res = auth_client.patch(
            f"/api/units/{unit.identifier}/checkins/{checkin.pk}/",
            {"message": "https://spam.com"},
        )
        assert res.status_code == status.HTTP_400_BAD_REQUEST
        data = res.json()
        assert "message" in data
        assert "non_field_errors" not in data

    def test_plain_message_is_accepted(self, auth_client, unit, mute_emails):
        res = auth_client.post(
            f"/api/units/{unit.identifier}/checkins/",
            {"location": LONDON_PAYLOAD, "message": "Found it near the old market!"},
            format="json",
        )
        assert res.status_code == status.HTTP_201_CREATED


class TestAdminOnlyCheckin:
    def test_regular_user_gets_403(self, client, db):
        admin_unit = UnitFactory.create(admin_only_checkin=True)
        client.force_authenticate(user=UserFactory.create())
        res = client.post(
            f"/api/units/{admin_unit.identifier}/checkins/",
            {"location": LONDON_PAYLOAD},
            format="json",
        )
        assert res.status_code == status.HTTP_403_FORBIDDEN

    def test_superuser_can_checkin(self, client, db, mute_emails):
        admin_unit = UnitFactory.create(admin_only_checkin=True)
        client.force_authenticate(user=UserFactory.create(is_superuser=True))
        res = client.post(
            f"/api/units/{admin_unit.identifier}/checkins/",
            {"location": LONDON_PAYLOAD},
            format="json",
        )
        assert res.status_code == status.HTTP_201_CREATED
