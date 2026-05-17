from django.core.cache import cache
from django.core.validators import RegexValidator
from django.db import models

from config.constants import UNIT_DISTANCE_CACHE_TTL
from flamerelay.users.models import User

from .fields import CaseInsensitiveCharField
from .game import Game
from .team import Team

_UNFETCHED = object()


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
    followers = models.ManyToManyField(User, related_name="followed_units", blank=True)
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
    def is_gps_enforced(self) -> bool:
        return self.game.is_gps_enforced if self.game else False

    def can_user_check_in(self, user, *, previous=_UNFETCHED) -> bool:
        # `previous` lets callers that already hold the unit's most recent
        # check-in skip the extra SELECT (see CheckInViewSet.perform_create).
        if not user or not getattr(user, "pk", None):
            return True  # anonymous always allowed; admin_only_checkin checked upstream
        if user.is_superuser:
            return True
        if previous is _UNFETCHED:
            previous = self.checkin_set.order_by("-date_created").first()
        if previous is not None and previous.created_by_id != user.pk:
            return not self.checkin_set.filter(created_by=user).exists()
        return True

    def get_distance_traveled(self) -> float:

        from backend.services import distance_traveled_in_km, unit_distance_cache_key  # noqa: PLC0415

        key = unit_distance_cache_key(self.identifier)
        cached = cache.get(key)
        if cached is None:
            cached = distance_traveled_in_km(self)
            cache.set(key, cached, UNIT_DISTANCE_CACHE_TTL)
        return cached
