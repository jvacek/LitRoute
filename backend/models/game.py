from datetime import timedelta

from django.db import models
from django.utils import timezone

from config.constants import (
    DISTANCE_DEFAULT_ALLOWED_TIME,
    GAME_GPS_DRIFT_FLOOR_METERS,
    HOT_POTATO_SHELF_LIFE,
)


class Game(models.Model):
    class Modes(models.TextChoices):
        RELAY = "relay", "Relay"
        RACE = "race", "Race"
        HOT_POTATO = "hot_potato", "Hot Potato"
        DISTANCE = "distance", "Distance"

    name = models.CharField(
        max_length=100,
        help_text="Display name shown on the leaderboard and intro modal.",
    )

    mode = models.CharField(
        max_length=20,
        choices=Modes.choices,
        default=Modes.RELAY,
    )

    start_time = models.DateTimeField(
        default=timezone.now,
        help_text="When the game starts. End time is start_time + allowed_time hours.",
    )

    allowed_time = models.PositiveIntegerField(
        default=DISTANCE_DEFAULT_ALLOWED_TIME,
        help_text="Total game duration in hours.",
    )

    gps_drift_floor = models.PositiveIntegerField(
        default=GAME_GPS_DRIFT_FLOOR_METERS,
        help_text=(
            "Floor of the drift envelope in meters. The server enforces "
            "`distance(pin, gps) ≤ max(this, reported accuracy)`, so this is "
            "the minimum allowance — never the cap. (Distance+Race modes.)"
        ),
    )

    shelf_life = models.PositiveIntegerField(
        default=HOT_POTATO_SHELF_LIFE,
        help_text="Time in hours before a check-in expires. (Hot Potato mode)",
    )

    # TODO implement postgis
    # goal_shape = models.MultiPolygonField()

    def __str__(self):
        return f"{self.name} ({self.get_mode_display()})"

    def get_absolute_url(self) -> str:
        return f"/game/{self.pk}/leaderboard/"

    @property
    def is_gps_enforced(self) -> bool:
        return self.mode in (
            self.Modes.RACE,
            self.Modes.HOT_POTATO,
            self.Modes.DISTANCE,
        )

    @property
    def end_time(self):
        return self.start_time + timedelta(hours=self.allowed_time)
