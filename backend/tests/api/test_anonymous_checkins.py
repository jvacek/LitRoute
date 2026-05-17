"""Anonymous check-in flow: create with edit_token, edit/delete via header,
guest subscribe + email verification, and Turnstile CAPTCHA gating."""

from __future__ import annotations

import uuid
from unittest.mock import patch

from allauth.account.models import EmailAddress
from django.contrib.auth import get_user_model
from django.core import signing
from rest_framework import status
from rest_framework.test import APIClient

from backend.factories import UnitFactory
from backend.models import CheckIn
from backend.tests.conftest import LONDON_PAYLOAD
from config.constants import CHECKIN_DELETE_GRACE_PERIOD_HOURS, CHECKIN_EDIT_GRACE_PERIOD_HOURS
from flamerelay.users.tests.factories import UserFactory


def _make_verify_token(email: str, unit_identifier: str, checkin_id: int) -> str:
    return signing.dumps(
        {"email": email, "unit": unit_identifier, "checkin_id": checkin_id},
        salt="guest-verify",
    )


# ── Anonymous create ───────────────────────────────────────────────────────────


class TestAnonCheckinCreate:
    def test_201_and_edit_token_returned(self, client, unit, mute_emails):

        res = client.post(
            f"/api/units/{unit.identifier}/checkins/",
            {"location": LONDON_PAYLOAD},
            format="json",
        )
        assert res.status_code == status.HTTP_201_CREATED
        data = res.json()
        uuid.UUID(data["edit_token"])  # raises ValueError on invalid UUID

    def test_created_by_fields_are_null(self, client, unit, mute_emails):
        res = client.post(
            f"/api/units/{unit.identifier}/checkins/",
            {"location": LONDON_PAYLOAD},
            format="json",
        )
        data = res.json()
        assert data["created_by_username"] is None
        assert data["created_by_name"] is None

    def test_admin_only_unit_returns_403(self, client, db):
        admin_unit = UnitFactory.create(admin_only_checkin=True)
        res = client.post(
            f"/api/units/{admin_unit.identifier}/checkins/",
            {"location": LONDON_PAYLOAD},
            format="json",
        )
        assert res.status_code == status.HTTP_403_FORBIDDEN

    def test_turnstile_failure_returns_400_with_captcha_error(self, client, unit, settings):
        settings.CLOUDFLARE_TURNSTILE_SECRET_KEY = "test-secret"  # noqa: S105
        with patch("backend.api.views._helpers._verify_turnstile", return_value=False):
            res = client.post(
                f"/api/units/{unit.identifier}/checkins/",
                {"location": LONDON_PAYLOAD, "turnstile_token": "bad-token"},
                format="json",
            )
        assert res.status_code == status.HTTP_400_BAD_REQUEST
        assert "captcha" in res.json()


# ── Anonymous edit ─────────────────────────────────────────────────────────────


class TestAnonCheckinEdit:
    def test_valid_token_within_grace_period_returns_200(self, client, unit, make_checkin):
        checkin = make_checkin(unit, anonymous=True)
        res = client.patch(
            f"/api/units/{unit.identifier}/checkins/{checkin.pk}/",
            {"message": "updated"},
            HTTP_X_EDIT_TOKEN=str(checkin.edit_token),
        )
        assert res.status_code == status.HTTP_200_OK

    def test_invalid_token_returns_403(self, client, unit, make_checkin):
        checkin = make_checkin(unit, anonymous=True)
        res = client.patch(
            f"/api/units/{unit.identifier}/checkins/{checkin.pk}/",
            {"message": "sneaky"},
            HTTP_X_EDIT_TOKEN="00000000-0000-0000-0000-000000000000",  # noqa: S106
        )
        assert res.status_code == status.HTTP_403_FORBIDDEN

    def test_missing_token_returns_403(self, client, unit, make_checkin):
        checkin = make_checkin(unit, anonymous=True)
        res = client.patch(
            f"/api/units/{unit.identifier}/checkins/{checkin.pk}/",
            {"message": "no token"},
        )
        assert res.status_code == status.HTTP_403_FORBIDDEN

    def test_token_in_request_body_is_ignored(self, client, unit, make_checkin):
        """Body-based token was removed from _check_edit_token; only the header is accepted."""
        checkin = make_checkin(unit, anonymous=True)
        res = client.patch(
            f"/api/units/{unit.identifier}/checkins/{checkin.pk}/",
            {"message": "body token attempt", "edit_token": str(checkin.edit_token)},
        )
        assert res.status_code == status.HTTP_403_FORBIDDEN

    def test_expired_token_returns_403(self, client, unit, make_checkin):
        checkin = make_checkin(unit, anonymous=True, hours_ago=CHECKIN_EDIT_GRACE_PERIOD_HOURS + 1)
        res = client.patch(
            f"/api/units/{unit.identifier}/checkins/{checkin.pk}/",
            {"message": "too late"},
            HTTP_X_EDIT_TOKEN=str(checkin.edit_token),
        )
        assert res.status_code == status.HTTP_403_FORBIDDEN

    def test_token_for_different_checkin_returns_403(self, client, unit, make_checkin):
        checkin_a = make_checkin(unit, anonymous=True)
        checkin_b = make_checkin(unit, anonymous=True)
        res = client.patch(
            f"/api/units/{unit.identifier}/checkins/{checkin_a.pk}/",
            {"message": "wrong token"},
            HTTP_X_EDIT_TOKEN=str(checkin_b.edit_token),
        )
        assert res.status_code == status.HTTP_403_FORBIDDEN


# ── Anonymous delete ───────────────────────────────────────────────────────────


class TestAnonCheckinDelete:
    def test_valid_token_within_grace_period_deletes(self, client, unit, make_checkin):
        checkin = make_checkin(unit, anonymous=True)
        res = client.delete(
            f"/api/units/{unit.identifier}/checkins/{checkin.pk}/",
            HTTP_X_EDIT_TOKEN=str(checkin.edit_token),
        )
        assert res.status_code == status.HTTP_204_NO_CONTENT
        assert not CheckIn.objects.filter(pk=checkin.pk).exists()

    def test_invalid_token_returns_403_and_checkin_survives(self, client, unit, make_checkin):
        checkin = make_checkin(unit, anonymous=True)
        res = client.delete(
            f"/api/units/{unit.identifier}/checkins/{checkin.pk}/",
            HTTP_X_EDIT_TOKEN="00000000-0000-0000-0000-000000000000",  # noqa: S106
        )
        assert res.status_code == status.HTTP_403_FORBIDDEN
        assert CheckIn.objects.filter(pk=checkin.pk).exists()

    def test_missing_token_returns_403(self, client, unit, make_checkin):
        checkin = make_checkin(unit, anonymous=True)
        res = client.delete(f"/api/units/{unit.identifier}/checkins/{checkin.pk}/")
        assert res.status_code == status.HTTP_403_FORBIDDEN

    def test_expired_token_returns_403_and_checkin_survives(self, client, unit, make_checkin):
        checkin = make_checkin(unit, anonymous=True, hours_ago=CHECKIN_DELETE_GRACE_PERIOD_HOURS + 1)
        res = client.delete(
            f"/api/units/{unit.identifier}/checkins/{checkin.pk}/",
            HTTP_X_EDIT_TOKEN=str(checkin.edit_token),
        )
        assert res.status_code == status.HTTP_403_FORBIDDEN
        assert CheckIn.objects.filter(pk=checkin.pk).exists()


# ── Guest subscribe ────────────────────────────────────────────────────────────


class TestGuestSubscribe:
    def test_valid_request_returns_201_and_enqueues_email(self, client, unit, make_checkin):
        checkin = make_checkin(unit, anonymous=True)
        with patch("backend.services.send_guest_verification_email_task.delay") as mock_task:
            res = client.post(
                f"/api/units/{unit.identifier}/guest-subscribe/",
                {"email": "sub@example.com", "checkin_id": checkin.pk},
                format="json",
            )
        assert res.status_code == status.HTTP_201_CREATED
        mock_task.assert_called_once()

    def test_invalid_email_format_returns_400(self, client, unit, make_checkin):
        checkin = make_checkin(unit, anonymous=True)
        res = client.post(
            f"/api/units/{unit.identifier}/guest-subscribe/",
            {"email": "not-an-email", "checkin_id": checkin.pk},
            format="json",
        )
        assert res.status_code == status.HTTP_400_BAD_REQUEST

    def test_missing_email_returns_400(self, client, unit, make_checkin):
        checkin = make_checkin(unit, anonymous=True)
        res = client.post(
            f"/api/units/{unit.identifier}/guest-subscribe/",
            {"checkin_id": checkin.pk},
            format="json",
        )
        assert res.status_code == status.HTTP_400_BAD_REQUEST

    def test_missing_checkin_id_returns_400(self, client, unit):
        res = client.post(
            f"/api/units/{unit.identifier}/guest-subscribe/",
            {"email": "sub@example.com"},
            format="json",
        )
        assert res.status_code == status.HTTP_400_BAD_REQUEST

    def test_owned_checkin_cannot_be_used_for_guest_subscribe(self, client, unit, make_checkin):
        owned = make_checkin(unit, UserFactory.create())
        res = client.post(
            f"/api/units/{unit.identifier}/guest-subscribe/",
            {"email": "sub@example.com", "checkin_id": owned.pk},
            format="json",
        )
        assert res.status_code == status.HTTP_404_NOT_FOUND

    def test_checkin_from_different_unit_returns_404(self, client, db, unit, make_checkin):
        other_unit = UnitFactory.create()
        checkin = make_checkin(other_unit, anonymous=True)
        res = client.post(
            f"/api/units/{unit.identifier}/guest-subscribe/",
            {"email": "sub@example.com", "checkin_id": checkin.pk},
            format="json",
        )
        assert res.status_code == status.HTTP_404_NOT_FOUND

    def test_nonexistent_unit_returns_404(self, client, db):
        res = client.post(
            "/api/units/NONE-99/guest-subscribe/",
            {"email": "sub@example.com", "checkin_id": 1},
            format="json",
        )
        assert res.status_code == status.HTTP_404_NOT_FOUND

    def test_csrf_required_for_anonymous_post(self, unit, make_checkin):
        """DRF skips CSRF for anon requests by default; our explicit enforce_csrf call restores it."""
        csrf_client = APIClient(enforce_csrf_checks=True)
        checkin = make_checkin(unit, anonymous=True)
        res = csrf_client.post(
            f"/api/units/{unit.identifier}/guest-subscribe/",
            {"email": "sub@example.com", "checkin_id": checkin.pk},
            format="json",
        )
        assert res.status_code == status.HTTP_403_FORBIDDEN


# ── Guest verify (email magic-link) ────────────────────────────────────────────


class TestGuestVerify:
    def test_valid_token_redirects_to_unit_page(self, client, unit, make_checkin):
        checkin = make_checkin(unit, anonymous=True)
        token = _make_verify_token("user@example.com", unit.identifier, checkin.pk)
        res = client.get(f"/api/guest-verify/?token={token}")
        assert res.status_code == status.HTTP_302_FOUND
        assert f"/unit/{unit.identifier}/" in res["Location"]

    def test_valid_token_claims_checkin_for_new_user(self, client, unit, make_checkin):
        checkin = make_checkin(unit, anonymous=True)
        token = _make_verify_token("claimer@example.com", unit.identifier, checkin.pk)
        client.get(f"/api/guest-verify/?token={token}")
        checkin.refresh_from_db()
        assert checkin.created_by is not None
        assert checkin.created_by.email == "claimer@example.com"

    def test_valid_token_subscribes_user_to_unit(self, client, unit, make_checkin):
        checkin = make_checkin(unit, anonymous=True)
        token = _make_verify_token("subscriber@example.com", unit.identifier, checkin.pk)
        client.get(f"/api/guest-verify/?token={token}")
        user = get_user_model().objects.get(email="subscriber@example.com")
        assert unit.subscribers.filter(pk=user.pk).exists()

    def test_valid_token_marks_email_as_verified(self, client, unit, make_checkin):
        checkin = make_checkin(unit, anonymous=True)
        token = _make_verify_token("verified@example.com", unit.identifier, checkin.pk)
        client.get(f"/api/guest-verify/?token={token}")
        assert EmailAddress.objects.get(email="verified@example.com").verified is True

    def test_valid_token_logs_user_in(self, client, unit, make_checkin):
        """Without a session bound to the verified user, the visitor would be
        locked out: created_by is set so the anon-isOwn branch no longer
        matches, and they have no auth session for the owner branch."""
        checkin = make_checkin(unit, anonymous=True)
        token = _make_verify_token("loggedin@example.com", unit.identifier, checkin.pk)
        client.get(f"/api/guest-verify/?token={token}")
        me_res = client.get("/api/account/")
        assert me_res.status_code == status.HTTP_200_OK
        user = get_user_model().objects.get(email="loggedin@example.com")
        assert me_res.json()["username"] == user.username

    def test_expired_token_returns_400(self, client, unit, make_checkin):
        checkin = make_checkin(unit, anonymous=True)
        token = _make_verify_token("old@example.com", unit.identifier, checkin.pk)
        with patch("backend.api.views.guest.GUEST_EMAIL_VERIFICATION_EXPIRY_SECONDS", new=-1):
            res = client.get(f"/api/guest-verify/?token={token}")
        assert res.status_code == status.HTTP_400_BAD_REQUEST

    def test_bad_signature_returns_400(self, client, db):
        res = client.get("/api/guest-verify/?token=not.a.valid.signed.token")
        assert res.status_code == status.HTTP_400_BAD_REQUEST

    def test_already_claimed_checkin_is_not_reclaimed(self, client, unit, make_checkin):
        checkin = make_checkin(unit, anonymous=True)

        client.get(f"/api/guest-verify/?token={_make_verify_token('first@example.com', unit.identifier, checkin.pk)}")
        checkin.refresh_from_db()
        first_owner = checkin.created_by
        assert first_owner is not None

        client.get(f"/api/guest-verify/?token={_make_verify_token('second@example.com', unit.identifier, checkin.pk)}")
        checkin.refresh_from_db()
        assert checkin.created_by == first_owner

    def test_checkin_from_wrong_unit_is_not_claimed(self, client, db, unit, make_checkin):
        """Unit filter in the claim query prevents cross-unit token abuse."""
        other_unit = UnitFactory.create()
        checkin = make_checkin(other_unit, anonymous=True)
        # Token says it belongs to `unit` but the checkin is on `other_unit`
        token = _make_verify_token("attacker@example.com", unit.identifier, checkin.pk)
        client.get(f"/api/guest-verify/?token={token}")
        checkin.refresh_from_db()
        assert checkin.created_by is None
