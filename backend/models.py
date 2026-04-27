import os
import re
import unicodedata
from uuid import uuid4

from django.contrib.gis.db.models import PointField
from django.core.exceptions import ValidationError
from django.core.validators import RegexValidator
from django.db import models
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver
from django.utils import timezone
from django_case_insensitive_field import CaseInsensitiveFieldMixin
from django_resized import ResizedImageField

from config.constants import (
    CHECKIN_ANONYMOUS_NAME_MAX_LENGTH,
    CHECKIN_IMAGE_MAX_UPLOAD_BYTES,
    DISTANCE_DEFAULT_ALLOWED_TIME,
    HOT_POTATO_SHELF_LIFE,
    LOCATION_CLAIM_MAX_DRIFT_METERS,
)
from flamerelay.users.models import User

from .services import send_email_to_subscribers_task, send_thank_you_email_task

_OBFUSCATED_DOT_RE = re.compile(r"[\(\[\{]\s*\.\s*[\)\]\}]")
_URL_RE = re.compile(r"(?:https?://|www\.|[a-zA-Z0-9-]+\.[a-zA-Z]{2,}/)\S*", re.IGNORECASE)


def _normalize_for_url_check(value: str) -> str:
    stripped = "".join(c for c in value if c in "\t\n\r" or unicodedata.category(c) not in ("Cc", "Cf"))
    return _OBFUSCATED_DOT_RE.sub(".", stripped)


# Create your models here.
# from django.utils.translation import ugettext_lazy as _


class Team(models.Model):
    name = models.SlugField(max_length=32, unique=True)

    def __str__(self):
        return self.name


class Game(models.Model):
    class Modes(models.TextChoices):
        RELAY = "relay", "Relay"
        RACE = "race", "Race"
        HOT_POTATO = "hot_potato", "Hot Potato"
        DISTANCE = "distance", "Distance"

    mode = models.CharField(
        max_length=20,
        choices=Modes.choices,
        default=Modes.RELAY,
    )

    allowed_time = models.PositiveIntegerField(
        default=DISTANCE_DEFAULT_ALLOWED_TIME,
        help_text="Time limit for the game in hours. (Distance mode)",
    )

    max_gps_drift = models.PositiveIntegerField(
        default=LOCATION_CLAIM_MAX_DRIFT_METERS,
        help_text="Maximum allowed GPS drift in meters for check-ins. (Distance+Race modes)",
    )

    shelf_life = models.PositiveIntegerField(
        default=HOT_POTATO_SHELF_LIFE,
        help_text="Time in hours before a check-in expires. (Hot Potato mode)",
    )

    # TODO implement postgis
    # goal_shape = models.MultiPolygonField()

    def __str__(self):
        return f"{self.get_mode_display()} + {self.id}"

    def is_gps_enforced(self) -> bool:
        return self.mode in (
            self.Modes.RACE,
            self.Modes.HOT_POTATO,
            self.Modes.DISTANCE,
        )


class CaseInsensitiveCharField(CaseInsensitiveFieldMixin, models.CharField):
    # FYI this class is imported directly in the migration so keep that in mind pls
    def __init__(self, *args, **kwargs):
        super(CaseInsensitiveFieldMixin, self).__init__(*args, **kwargs)


class Unit(models.Model):
    identifier = CaseInsensitiveCharField(
        max_length=200,
        unique=True,
        validators=[
            RegexValidator(
                regex=r"^\w{3,}",
                message="Identifier must start with at least three characters",
            ),
            RegexValidator(
                regex=r"\d{2,}$",
                message="Identifier must end with two digits",
            ),
            RegexValidator(
                regex=r"^\w*-\d*$",
                message="Characters and digits must be separated by a dash",
            ),
        ],
        help_text="Unique identifier for the unit, e.g. 'alpha-01'. Must start with at least three characters and end "
        "with two digits, separated by a dash.",
    )
    date_created = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        help_text="User that created the unit",
    )
    team = models.ForeignKey(
        Team, on_delete=models.SET_NULL, null=True, blank=True, help_text="Optional team that the unit belongs to"
    )
    subscribers = models.ManyToManyField(User, related_name="subscribed_units", blank=True)
    admin_only_checkin = models.BooleanField(
        default=False,
        help_text="Whether only admins can check in to this unit, primarily used for demos or for disabling lighters.",
    )
    game = models.ForeignKey(Game, on_delete=models.PROTECT, null=True, blank=True)

    class Meta:
        verbose_name = "Unit"
        verbose_name_plural = "Units"

    def __str__(self):
        return self.identifier

    def get_absolute_url(self) -> str:
        return f"/unit/{self.identifier}/"

    @property
    def is_gps_location_enforced(self) -> bool:
        return self.game.is_gps_enforced() if self.game else False

    def can_user_check_in(self, user) -> bool:
        if not user or not getattr(user, "pk", None):
            return True  # anonymous always allowed; admin_only_checkin checked upstream
        if user.is_superuser:
            return True
        qs = self.checkin_set.order_by("-date_created")
        last = qs.first()
        if last is not None and last.created_by_id != user.pk:
            return not qs.filter(created_by=user).exists()
        return True

    def get_distance_traveled(self) -> float:
        from django.core.cache import cache  # noqa: PLC0415

        from config.constants import UNIT_DISTANCE_CACHE_TTL  # noqa: PLC0415

        from .services import distance_traveled_in_km, unit_distance_cache_key  # noqa: PLC0415

        key = unit_distance_cache_key(self.identifier)
        cached = cache.get(key)
        if cached is None:
            cached = distance_traveled_in_km(self)
            cache.set(key, cached, UNIT_DISTANCE_CACHE_TTL)
        return cached


def path_and_rename(instance, filename):
    # This omne is in the migrations so keep that in mind pls
    upload_to = "checkins/"
    ext = filename.split(".")[-1]
    filename = f"{uuid4().hex}.{ext}"
    return os.path.join(upload_to, filename)  # noqa: PTH118


def validate_image_size(value):
    if value and value.size > CHECKIN_IMAGE_MAX_UPLOAD_BYTES:
        mb = CHECKIN_IMAGE_MAX_UPLOAD_BYTES // (1024 * 1024)
        msg = f"Image file too large. Maximum size is {mb} MB."
        raise ValidationError(msg)


def validate_no_urls(value: str) -> None:
    normalized = _normalize_for_url_check(value)
    match = _URL_RE.search(normalized)
    if match:
        msg = f"Links and URLs are not allowed in messages (found: '{match.group()}')."
        raise ValidationError(msg)


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

    def send_email_to_subscribers(self, **kwargs):
        from django.conf import settings  # noqa: PLC0415

        from config.constants import CHECKIN_EMAIL_DELAY_SECONDS  # noqa: PLC0415

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


@receiver(post_save, sender=Unit)
def subscribe_creator_on_unit_create(sender, instance, created, **kwargs):
    if created:
        instance.subscribers.add(instance.created_by)


@receiver(post_save, sender=CheckIn)
def send_email_to_subscribers_signal(sender, instance, created, **kwargs):
    if created:
        instance.send_email_to_subscribers(**kwargs)


@receiver(post_delete, sender=CheckInImage)
def delete_checkin_image_file(sender, instance, **kwargs):
    if instance.image:
        from django.db import transaction  # noqa: PLC0415

        from .services import delete_checkin_image_file_task  # noqa: PLC0415

        image_name = instance.image.name
        transaction.on_commit(lambda: delete_checkin_image_file_task.delay(image_name))
