from django.conf import settings
from django.contrib.gis.db.models import PointField
from django.db import models
from django.db.models.functions import Length
from django.utils import timezone
from django_resized import ResizedImageField

from backend.services import send_email_to_followers_task, send_thank_you_email_task
from config.constants import (
    CHECKIN_ANONYMOUS_NAME_MAX_LENGTH,
    CHECKIN_EMAIL_DELAY_SECONDS,
    CHECKIN_IMAGE_MAX_EDGE_PX,
    CHECKIN_MESSAGE_MAX_LENGTH,
)
from flamerelay.users.models import User

from .unit import Unit
from .validators import path_and_rename, validate_image_size, validate_no_urls

# CheckIn.Meta's CheckConstraint uses `message__length__lte`; register the
# Length transform on TextField at import time so the lookup resolves when
# migrations build the constraint's SQL.
models.TextField.register_lookup(Length)


class CheckIn(models.Model):
    unit = models.ForeignKey(Unit, on_delete=models.CASCADE)
    date_created = models.DateTimeField(editable=False, default=timezone.now)
    created_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL)
    edit_token = models.UUIDField(null=True, blank=True, unique=True)
    anonymous_name = models.CharField(max_length=CHECKIN_ANONYMOUS_NAME_MAX_LENGTH, blank=True, default="")
    message = models.TextField(blank=True, max_length=CHECKIN_MESSAGE_MAX_LENGTH, validators=[validate_no_urls])
    place = models.CharField(max_length=200, blank=True)
    location = PointField(geography=True)

    class Meta:
        ordering = ["-date_created"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(message__length__lte=CHECKIN_MESSAGE_MAX_LENGTH),
                name="checkin_message_max_length",
            ),
        ]

    def __str__(self):
        return f"{self.unit!s} {self.date_created!s}"

    def get_absolute_url(self) -> str:
        return f"/unit/{self.unit.identifier}/"

    def send_email_to_followers(self, **kwargs):

        countdown = 0 if settings.DEBUG else CHECKIN_EMAIL_DELAY_SECONDS
        send_email_to_followers_task.apply_async(args=[self.pk], countdown=countdown)
        send_thank_you_email_task.apply_async(args=[self.pk], countdown=countdown)


class CheckInImage(models.Model):
    # Nullable while an upload is "pending" — the row exists, the file is on
    # disk, but the user hasn't yet submitted the parent check-in. Attach
    # happens atomically via a single conditional UPDATE in
    # CheckinImageManager.attach_pending().
    checkin = models.ForeignKey(CheckIn, null=True, blank=True, on_delete=models.CASCADE, related_name="images")
    image = ResizedImageField(
        upload_to=path_and_rename,
        size=[CHECKIN_IMAGE_MAX_EDGE_PX, CHECKIN_IMAGE_MAX_EDGE_PX],
        force_format="WEBP",
        quality=85,
        validators=[validate_image_size],
    )
    order = models.PositiveSmallIntegerField(default=0)
    # Unguessable handle returned to the uploader. Cleared on attach so an
    # already-attached row can't be re-claimed.
    attach_token = models.CharField(max_length=64, unique=True, null=True, blank=True, db_index=True)
    # Ownership at attach time. Authed uploads set `uploaded_by`; anonymous
    # uploads set `session_key`. Attach matches on the same identity.
    uploaded_by = models.ForeignKey(
        User, null=True, blank=True, on_delete=models.CASCADE, related_name="pending_uploads"
    )
    session_key = models.CharField(max_length=40, blank=True)
    # Explicit `default=timezone.now` rather than `auto_now_add=True` so the
    # initial migration can backfill existing (already-attached) rows without
    # an interactive prompt. The cleanup task only looks at rows where
    # checkin_id IS NULL, so the value on already-attached rows is unused.
    uploaded_at = models.DateTimeField(default=timezone.now, editable=False)

    class Meta:
        ordering = ["order"]

    def __str__(self) -> str:
        return f"CheckInImage {self.pk} for CheckIn {self.checkin_id}"
