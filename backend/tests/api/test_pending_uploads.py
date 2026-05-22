"""Request-layer tests for the per-image upload flow.

Two endpoints participate:
  - POST /api/units/<id>/pending-images/  → mints an attach_token for one file
  - POST /api/units/<id>/checkins/        → consumes a list of tokens

Behaviour we care about (and that isn't already covered by DRF/Django):
  - Authed and anon paths persist the right ownership
  - Anon Turnstile gate fires once per session, then short-circuits
  - Cross-session attach is rejected without leaking whether the token existed
  - TTL expiry, double-attach, and the per-session cap all return 400 cleanly
"""

from __future__ import annotations

from datetime import timedelta
from io import BytesIO
from unittest.mock import patch

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse
from django.utils import timezone
from PIL import Image
from rest_framework import status
from rest_framework.test import APIClient

from backend.models import CheckIn, CheckInImage
from config.constants import (
    CHECKIN_IMAGE_MAX_UPLOAD_BYTES,
    CHECKIN_PENDING_UPLOAD_MAX_PER_SESSION,
    CHECKIN_PENDING_UPLOAD_TTL_HOURS,
)


def _png(width: int = 64, height: int = 64) -> bytes:
    buf = BytesIO()
    Image.new("RGB", (width, height), color=(200, 100, 50)).save(buf, format="PNG")
    return buf.getvalue()


def _upload(name: str = "test.png", *, width: int = 64, height: int = 64) -> SimpleUploadedFile:
    return SimpleUploadedFile(name, _png(width, height), content_type="image/png")


def _pending_url(unit) -> str:
    return reverse("api:pending-images", kwargs={"identifier": unit.identifier})


def _checkin_url(unit) -> str:
    return reverse("api:checkin-list", kwargs={"identifier": unit.identifier})


def _checkin_detail_url(unit, pk: int) -> str:
    return reverse("api:checkin-detail", kwargs={"identifier": unit.identifier, "pk": pk})


# Reused payload for /checkins/ — non-game units accept just a location.
_LONDON_BODY = {"location": {"type": "Point", "coordinates": [-0.1278, 51.5074]}}


# ── Happy path ───────────────────────────────────────────────────────────────


class TestPendingUploadHappyPath:
    def test_authed_user_uploads_then_attaches(self, auth_client, unit, mute_emails):
        res = auth_client.post(_pending_url(unit), {"image": _upload()}, format="multipart")
        assert res.status_code == status.HTTP_201_CREATED
        token = res.json()["token"]
        assert token  # token field is populated
        # image.url is absolute under the test storage backend; in dev/prod
        # it's `/media/checkins/...`. Assert on the stable suffix.
        assert "/checkins/" in res.json()["preview_url"]
        assert res.json()["preview_url"].endswith(".webp")

        # The row exists, file is on disk, checkin is null until attach.
        pending = CheckInImage.objects.get(attach_token=token)
        assert pending.checkin_id is None
        assert pending.uploaded_by is not None

        res = auth_client.post(
            _checkin_url(unit),
            {**_LONDON_BODY, "pending_image_tokens": [token]},
            format="json",
        )
        assert res.status_code == status.HTTP_201_CREATED
        # After attach: row points at the new checkin, token is cleared.
        pending.refresh_from_db()
        assert pending.checkin_id == res.json()["id"]
        assert pending.attach_token is None
        assert pending.order == 0

    def test_anon_uploads_then_attaches(self, client, unit, mute_emails):
        res = client.post(
            _pending_url(unit),
            {"image": _upload(), "turnstile_token": "x"},
            format="multipart",
        )
        assert res.status_code == status.HTTP_201_CREATED
        token = res.json()["token"]
        pending = CheckInImage.objects.get(attach_token=token)
        assert pending.uploaded_by is None
        assert pending.session_key != ""  # anon ownership lives here

        res = client.post(
            _checkin_url(unit),
            {**_LONDON_BODY, "pending_image_tokens": [token]},
            format="json",
        )
        assert res.status_code == status.HTTP_201_CREATED
        pending.refresh_from_db()
        assert pending.checkin_id == res.json()["id"]

    def test_tokens_attached_in_listed_order(self, auth_client, unit, mute_emails):
        tokens = [
            auth_client.post(_pending_url(unit), {"image": _upload(name=f"{i}.png")}, format="multipart").json()[
                "token"
            ]
            for i in range(3)
        ]
        # Submit in reverse order; the order field on the rows must reflect it.
        res = auth_client.post(
            _checkin_url(unit),
            {**_LONDON_BODY, "pending_image_tokens": list(reversed(tokens))},
            format="json",
        )
        assert res.status_code == status.HTTP_201_CREATED
        checkin = CheckIn.objects.get(pk=res.json()["id"])
        orders_by_token = {img.order: img.pk for img in checkin.images.order_by("order")}
        # Find the row whose tokens used to be in the reverse list and check
        # they map to ascending `order` values starting at 0.
        assert list(orders_by_token.keys()) == [0, 1, 2]


# ── Turnstile gate ───────────────────────────────────────────────────────────


class TestPendingUploadTurnstileGate:
    def test_anon_first_call_requires_token(self, client, unit):
        with patch("backend.api.views._helpers._verify_turnstile", return_value=False):
            res = client.post(_pending_url(unit), {"image": _upload()}, format="multipart")
        assert res.status_code == status.HTTP_400_BAD_REQUEST
        assert "captcha" in res.json()
        assert not CheckInImage.objects.exists()

    def test_anon_second_call_skips_turnstile(self, client, unit):
        # First call passes (autouse fixture mocks verify -> True), which sets
        # the session flag. The second call uses a verify mock that would
        # *fail*; we still expect 201 because the flag short-circuits.
        first = client.post(_pending_url(unit), {"image": _upload()}, format="multipart")
        assert first.status_code == status.HTTP_201_CREATED
        with patch("backend.api.views._helpers._verify_turnstile", return_value=False):
            second = client.post(_pending_url(unit), {"image": _upload(name="2.png")}, format="multipart")
        assert second.status_code == status.HTTP_201_CREATED

    def test_authed_user_never_needs_turnstile(self, auth_client, unit):
        with patch("backend.api.views._helpers._verify_turnstile", return_value=False) as mock_verify:
            res = auth_client.post(_pending_url(unit), {"image": _upload()}, format="multipart")
        assert res.status_code == status.HTTP_201_CREATED
        mock_verify.assert_not_called()


# ── Anti-enumeration ─────────────────────────────────────────────────────────


class TestPendingUploadAntiEnumeration:
    def test_attach_rejects_token_belonging_to_a_different_anon_session(self, unit, mute_emails):
        # Session A uploads.
        client_a = APIClient()
        res = client_a.post(_pending_url(unit), {"image": _upload()}, format="multipart")
        assert res.status_code == status.HTTP_201_CREATED
        token = res.json()["token"]

        # Session B (a fresh client → fresh Django session) tries to attach
        # it to its own check-in.
        client_b = APIClient()
        res = client_b.post(
            _checkin_url(unit),
            {**_LONDON_BODY, "pending_image_tokens": [token]},
            format="json",
        )
        assert res.status_code == status.HTTP_400_BAD_REQUEST
        # The error message must NOT distinguish "token didn't exist" from
        # "token belonged to someone else" — both feed the same enumeration
        # vector. We assert the message is on the tokens field and is generic.
        body = res.json()
        assert "pending_image_tokens" in body
        # No new check-in was created.
        assert not CheckIn.objects.exists()
        # The pending row survives, still owned by session A — session B's
        # failed attempt didn't clear it.
        pending = CheckInImage.objects.get(attach_token=token)
        assert pending.checkin_id is None

    def test_attach_rejects_authed_token_used_by_anon(self, auth_client, unit, mute_emails):
        # User Alice uploads.
        res = auth_client.post(_pending_url(unit), {"image": _upload()}, format="multipart")
        token = res.json()["token"]

        # Anon caller (fresh client) tries to claim it.
        client = APIClient()
        res = client.post(
            _checkin_url(unit),
            {**_LONDON_BODY, "pending_image_tokens": [token]},
            format="json",
        )
        assert res.status_code == status.HTTP_400_BAD_REQUEST
        assert "pending_image_tokens" in res.json()
        assert not CheckIn.objects.exists()


# ── Failure modes ────────────────────────────────────────────────────────────


class TestPendingUploadFailureModes:
    def test_missing_image_field_returns_400(self, auth_client, unit):
        res = auth_client.post(_pending_url(unit), {}, format="multipart")
        assert res.status_code == status.HTTP_400_BAD_REQUEST
        assert "image" in res.json()

    def test_oversized_image_rejected(self, auth_client, unit):
        # validate_image_size on the model rejects > 10 MB. Use a payload that
        # blows past the cap (the bytes don't need to be a valid image — the
        # validator runs on `value.size`, not on decode).
        big = SimpleUploadedFile(
            "huge.png",
            b"x" * (CHECKIN_IMAGE_MAX_UPLOAD_BYTES + 1),
            content_type="image/png",
        )
        res = auth_client.post(_pending_url(unit), {"image": big}, format="multipart")
        assert res.status_code == status.HTTP_400_BAD_REQUEST

    def test_per_session_cap_blocks_further_uploads(self, auth_client, unit):
        # Backfill the cap with cheap rows so we don't have to POST 20 files.
        for i in range(CHECKIN_PENDING_UPLOAD_MAX_PER_SESSION):
            CheckInImage.objects.create(
                checkin=None,
                image=SimpleUploadedFile(f"f{i}.png", _png(), content_type="image/png"),
                attach_token=f"existing-token-{i}",
                uploaded_by=auth_client.handler._force_user,  # the force-auth user
                session_key="",
            )
        res = auth_client.post(_pending_url(unit), {"image": _upload()}, format="multipart")
        assert res.status_code == status.HTTP_400_BAD_REQUEST
        assert "image" in res.json()

    def test_double_attach_returns_400(self, auth_client, unit, mute_emails):
        res = auth_client.post(_pending_url(unit), {"image": _upload()}, format="multipart")
        token = res.json()["token"]

        # First attach succeeds.
        first = auth_client.post(
            _checkin_url(unit),
            {**_LONDON_BODY, "pending_image_tokens": [token]},
            format="json",
        )
        assert first.status_code == status.HTTP_201_CREATED

        # Second attach with the same token must fail cleanly — the row is
        # now bound to the first check-in, so the conditional UPDATE matches
        # 0 rows and the manager raises.
        second = auth_client.post(
            _checkin_url(unit),
            {**_LONDON_BODY, "pending_image_tokens": [token]},
            format="json",
        )
        assert second.status_code == status.HTTP_400_BAD_REQUEST
        # The second check-in did not survive: the request rolled back.
        assert CheckIn.objects.count() == 1

    def test_expired_token_rejected(self, auth_client, unit, mute_emails):
        res = auth_client.post(_pending_url(unit), {"image": _upload()}, format="multipart")
        token = res.json()["token"]

        # Backdate the row past the TTL. uploaded_at is bypassed via .update()
        # so we don't hit the editable=False / auto-now path.
        expired_at = timezone.now() - timedelta(hours=CHECKIN_PENDING_UPLOAD_TTL_HOURS + 1)
        CheckInImage.objects.filter(attach_token=token).update(uploaded_at=expired_at)

        res = auth_client.post(
            _checkin_url(unit),
            {**_LONDON_BODY, "pending_image_tokens": [token]},
            format="json",
        )
        assert res.status_code == status.HTTP_400_BAD_REQUEST
        assert "pending_image_tokens" in res.json()
        assert not CheckIn.objects.exists()


# ── Partial failure isolation ────────────────────────────────────────────────


@pytest.mark.django_db
class TestAttachAtomicity:
    def test_attach_failure_rolls_back_the_whole_checkin(self, auth_client, unit, mute_emails):
        """If any of the requested tokens fails (expired, wrong owner, etc.),
        the entire check-in must not survive — no partial state."""
        good = auth_client.post(_pending_url(unit), {"image": _upload()}, format="multipart").json()["token"]
        res = auth_client.post(
            _checkin_url(unit),
            {**_LONDON_BODY, "pending_image_tokens": [good, "nonexistent-token"]},
            format="json",
        )
        assert res.status_code == status.HTTP_400_BAD_REQUEST
        # No CheckIn row, and the "good" pending upload remains pending and
        # available for a retry.
        assert not CheckIn.objects.exists()
        pending = CheckInImage.objects.get(attach_token=good)
        assert pending.checkin_id is None


# ── Edit (PATCH) flow ───────────────────────────────────────────────────────


@pytest.mark.django_db
class TestEditFlowWithPendingTokens:
    """PATCH /api/units/<id>/checkins/<pk>/ now consumes pending_image_tokens
    for newly-added photos (alongside remove_image_ids + image_ids_order for
    existing ones). These checks are distinct from the create path: they
    enforce the *total* image count (remaining-after-removal + new) and have
    to leave existing images untouched on failure."""

    def _make_authed_checkin_with_image(self, auth_client, unit):
        """Create a check-in with one image attached, via the API."""
        first_token = auth_client.post(_pending_url(unit), {"image": _upload()}, format="multipart").json()["token"]
        res = auth_client.post(
            _checkin_url(unit),
            {**_LONDON_BODY, "pending_image_tokens": [first_token]},
            format="json",
        )
        assert res.status_code == status.HTTP_201_CREATED
        return res.json()["id"]

    def test_patch_attaches_new_pending_image(self, auth_client, unit, mute_emails):
        checkin_id = self._make_authed_checkin_with_image(auth_client, unit)
        existing = CheckIn.objects.get(pk=checkin_id).images.get()
        new_token = auth_client.post(_pending_url(unit), {"image": _upload(name="b.png")}, format="multipart").json()[
            "token"
        ]

        res = auth_client.patch(
            _checkin_detail_url(unit, checkin_id),
            {"pending_image_tokens": [new_token]},
            format="json",
        )
        assert res.status_code == status.HTTP_200_OK
        images = list(CheckIn.objects.get(pk=checkin_id).images.order_by("order"))
        # Existing image stays at order 0, new one appended at order 1.
        assert [img.id for img in images] == [existing.id, *[i.id for i in images if i.id != existing.id]]
        assert any(img.attach_token is None and img.id != existing.id for img in images)

    def test_patch_removes_old_and_attaches_new_in_one_request(self, auth_client, unit, mute_emails):
        checkin_id = self._make_authed_checkin_with_image(auth_client, unit)
        existing = CheckIn.objects.get(pk=checkin_id).images.get()
        new_token = auth_client.post(_pending_url(unit), {"image": _upload(name="b.png")}, format="multipart").json()[
            "token"
        ]

        res = auth_client.patch(
            _checkin_detail_url(unit, checkin_id),
            {
                "remove_image_ids": [existing.id],
                "pending_image_tokens": [new_token],
            },
            format="json",
        )
        assert res.status_code == status.HTTP_200_OK
        images = list(CheckIn.objects.get(pk=checkin_id).images.all())
        assert len(images) == 1
        assert images[0].id != existing.id
        assert images[0].attach_token is None  # cleared on attach

    def test_patch_rejects_exceeding_max_images(self, auth_client, unit, mute_emails):
        # Set up a check-in already at the max-1 mark so the next PATCH would
        # cross the line. The serializer accepts up to CHECKIN_MAX_IMAGES
        # tokens per request, so we pre-attach four images to push us to the
        # boundary.
        from config.constants import CHECKIN_MAX_IMAGES  # noqa: PLC0415

        tokens = [
            auth_client.post(_pending_url(unit), {"image": _upload(name=f"{i}.png")}, format="multipart").json()[
                "token"
            ]
            for i in range(CHECKIN_MAX_IMAGES - 1)
        ]
        res = auth_client.post(
            _checkin_url(unit),
            {**_LONDON_BODY, "pending_image_tokens": tokens},
            format="json",
        )
        assert res.status_code == status.HTTP_201_CREATED
        checkin_id = res.json()["id"]

        # Two more tokens would push past the cap (count + 2 > MAX).
        extras = [
            auth_client.post(_pending_url(unit), {"image": _upload(name=f"x{i}.png")}, format="multipart").json()[
                "token"
            ]
            for i in range(2)
        ]
        res = auth_client.patch(
            _checkin_detail_url(unit, checkin_id),
            {"pending_image_tokens": extras},
            format="json",
        )
        assert res.status_code == status.HTTP_400_BAD_REQUEST
        assert "pending_image_tokens" in res.json()
        # Existing images untouched; "extra" tokens still pending and
        # available for re-use against a different check-in.
        assert CheckIn.objects.get(pk=checkin_id).images.count() == CHECKIN_MAX_IMAGES - 1
        assert CheckInImage.objects.filter(attach_token__in=extras, checkin__isnull=True).count() == len(extras)

    def test_patch_rejects_token_from_another_users_session(self, auth_client, unit, user, make_checkin, mute_emails):
        """Anti-enumeration on the edit path: the owner's PATCH can't attach
        a pending row that another session uploaded."""
        # The auth_client owns the check-in.
        checkin = make_checkin(unit, user)

        # A different user uploads a pending image.
        from rest_framework.test import APIClient  # noqa: PLC0415

        from flamerelay.users.tests.factories import UserFactory  # noqa: PLC0415

        other_user = UserFactory.create()
        other_client = APIClient()
        other_client.force_authenticate(user=other_user)
        stolen_token = other_client.post(_pending_url(unit), {"image": _upload()}, format="multipart").json()["token"]

        res = auth_client.patch(
            _checkin_detail_url(unit, checkin.id),
            {"pending_image_tokens": [stolen_token]},
            format="json",
        )
        assert res.status_code == status.HTTP_400_BAD_REQUEST
        assert "pending_image_tokens" in res.json()
        # Stolen token still belongs to the other user.
        assert CheckInImage.objects.get(attach_token=stolen_token).uploaded_by == other_user
