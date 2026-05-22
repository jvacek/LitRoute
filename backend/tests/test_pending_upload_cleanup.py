"""Test the orphaned-pending-uploads cleanup task.

The task deletes CheckInImage rows where `checkin_id IS NULL` and
`uploaded_at` is older than the TTL. Two things have to hold:

  - Attached rows (checkin_id IS NOT NULL) are never touched, regardless
    of how old they are. They're real check-in photos, not pending uploads.
  - Fresh pending rows (uploaded_at within TTL) survive — a user mid-form
    shouldn't have their already-uploaded photos pruned out from under them.

The race-safety between this task and a concurrent `attach_pending` is
covered by the API tests around double-attach and TTL expiry; here we just
verify the bulk-delete behaviour in isolation.
"""

from __future__ import annotations

from datetime import timedelta
from io import BytesIO

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from PIL import Image

from backend.models import CheckInImage
from backend.services import cleanup_orphaned_pending_uploads
from config.constants import CHECKIN_PENDING_UPLOAD_TTL_HOURS


def _png_bytes() -> bytes:
    buf = BytesIO()
    Image.new("RGB", (32, 32), color=(0, 0, 0)).save(buf, format="PNG")
    return buf.getvalue()


def _upload(name: str = "p.png") -> SimpleUploadedFile:
    return SimpleUploadedFile(name, _png_bytes(), content_type="image/png")


@pytest.fixture
def make_pending(db):
    """Create a CheckInImage with checkin=None and a chosen `uploaded_at`."""

    def _make(hours_ago: float = 0.0) -> CheckInImage:
        img = CheckInImage.objects.create(
            checkin=None,
            image=_upload(),
            attach_token=f"tok-{hours_ago}-{timezone.now().timestamp()}",
        )
        if hours_ago:
            CheckInImage.objects.filter(pk=img.pk).update(
                uploaded_at=timezone.now() - timedelta(hours=hours_ago),
            )
            img.refresh_from_db()
        return img

    return _make


@pytest.mark.django_db
class TestPendingUploadCleanup:
    def test_deletes_expired_pending_rows(self, make_pending):
        expired = make_pending(hours_ago=CHECKIN_PENDING_UPLOAD_TTL_HOURS + 1)
        n = cleanup_orphaned_pending_uploads()
        assert n == 1
        assert not CheckInImage.objects.filter(pk=expired.pk).exists()

    def test_leaves_fresh_pending_rows_alone(self, make_pending):
        fresh = make_pending(hours_ago=1)  # well inside TTL
        n = cleanup_orphaned_pending_uploads()
        assert n == 0
        assert CheckInImage.objects.filter(pk=fresh.pk).exists()

    def test_never_touches_attached_rows(self, make_pending, unit, make_checkin, user):
        checkin = make_checkin(unit, user)
        # Old enough that the TTL predicate matches, but the row is already
        # attached to a checkin — the WHERE clause must exclude it.
        attached = make_pending(hours_ago=CHECKIN_PENDING_UPLOAD_TTL_HOURS + 100)
        CheckInImage.objects.filter(pk=attached.pk).update(checkin=checkin)
        n = cleanup_orphaned_pending_uploads()
        assert n == 0
        assert CheckInImage.objects.filter(pk=attached.pk, checkin=checkin).exists()

    def test_batches_through_many_pending_rows(self, make_pending):
        # Build a small but multi-batch population by creating a few expired
        # rows; the task's while-loop should drain them all in one call.
        ids = [make_pending(hours_ago=CHECKIN_PENDING_UPLOAD_TTL_HOURS + i + 1).pk for i in range(5)]
        n = cleanup_orphaned_pending_uploads()
        assert n == len(ids)
        assert not CheckInImage.objects.filter(pk__in=ids).exists()
