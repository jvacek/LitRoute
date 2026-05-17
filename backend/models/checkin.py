from django.conf import settings
from django.contrib.gis.db.models import PointField
from django.db import models
from django.utils import timezone
from django_resized import ResizedImageField

from backend.services import send_email_to_subscribers_task, send_thank_you_email_task
from config.constants import (
    CHECKIN_ANONYMOUS_NAME_MAX_LENGTH,
    CHECKIN_EMAIL_DELAY_SECONDS,
)
from flamerelay.users.models import User

from .unit import Unit
from .validators import path_and_rename, validate_image_size, validate_no_urls


class CheckIn(models.Model):
    unit = models.ForeignKey(Unit, on_delete=models.CASCADE)
    date_created = models.DateTimeField(editable=False, default=timezone.now)
    created_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL)
    edit_token = models.UUIDField(null=True, blank=True, unique=True)
    anonymous_name = models.CharField(max_length=CHECKIN_ANONYMOUS_NAME_MAX_LENGTH, blank=True, default="")
    message = models.TextField(blank=True, validators=[validate_no_urls])
    place = models.CharField(max_length=200, blank=True)
    location = PointField(geography=True)

    class Meta:
        ordering = ["-date_created"]

    def __str__(self):
        return f"{self.unit!s} {self.date_created!s}"

    def get_absolute_url(self) -> str:
        return f"/unit/{self.unit.identifier}/"

    def send_email_to_subscribers(self, **kwargs):

        countdown = 0 if settings.DEBUG else CHECKIN_EMAIL_DELAY_SECONDS
        send_email_to_subscribers_task.apply_async(args=[self.pk], countdown=countdown)
        send_thank_you_email_task.apply_async(args=[self.pk], countdown=countdown)


class CheckInImage(models.Model):
    checkin = models.ForeignKey(CheckIn, on_delete=models.CASCADE, related_name="images")
    image = ResizedImageField(
        upload_to=path_and_rename,
        size=[1024, 1024],
        force_format="WEBP",
        quality=85,
        validators=[validate_image_size],
    )
    order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["order"]

    def __str__(self) -> str:
        return f"CheckInImage {self.pk} for CheckIn {self.checkin_id}"
