"""Idempotent seed for Playwright e2e tests.

Creates three units with fixed identifiers so the e2e specs can navigate to
known URLs without first having to create state through the API:

- `e2enongame-01`  — no game attached
- `e2egame-01`     — attached to a DISTANCE-mode game
- `e2emap-01`      — three check-ins over open ocean for the unit-map spec

All are owned by an `e2e@litroute.test` user, created on demand. Existing
units (and their check-ins) under these identifiers are deleted before
recreation so the tests start from a clean slate every run.
"""

from __future__ import annotations

from datetime import timedelta

from django.contrib.gis.geos import Point
from django.core.cache import cache
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from backend.models import CheckIn, Game, Unit
from flamerelay.users.models import User

E2E_USER_EMAIL = "e2e@litroute.test"
NONGAME_IDENTIFIER = "e2enongame-01"
GAME_IDENTIFIER = "e2egame-01"
MAP_IDENTIFIER = "e2emap-01"
GAME_NAME = "E2E Distance Game"

# Open-ocean waypoints: the MapTiler style draws no roads or orange features
# there, so amber/ember pixels in a map screenshot can only be the markers.
MAP_CHECKINS = [
    ("Mid-Atlantic waypoint A", -30.0, 40.0),
    ("Mid-Atlantic waypoint B", -40.0, 35.0),
    ("Mid-Atlantic waypoint C", -50.0, 30.0),
]


class Command(BaseCommand):
    help = "Seed three fixed units for Playwright e2e tests (idempotent)."

    @transaction.atomic
    def handle(self, *args, **options):
        user, _ = User.objects.get_or_create(
            email=E2E_USER_EMAIL,
            defaults={"username": "e2e_user", "name": "E2E Test User"},
        )

        # Drop existing fixtures so the seed is idempotent across runs.
        # CheckIns must go first — Unit.created_by uses on_delete=PROTECT,
        # which CheckIn.unit (CASCADE) implicitly handles, but the games
        # we recreate below also use PROTECT.
        existing_units = Unit.objects.filter(identifier__in=[NONGAME_IDENTIFIER, GAME_IDENTIFIER, MAP_IDENTIFIER])
        CheckIn.objects.filter(unit__in=existing_units).delete()
        existing_units.delete()
        Game.objects.filter(name=GAME_NAME).delete()

        Unit.objects.create(identifier=NONGAME_IDENTIFIER, created_by=user)

        game = Game.objects.create(name=GAME_NAME, mode=Game.Modes.DISTANCE)
        Unit.objects.create(identifier=GAME_IDENTIFIER, created_by=user, game=game)

        map_unit = Unit.objects.create(identifier=MAP_IDENTIFIER, created_by=user)
        now = timezone.now()
        for age_days, (place, lng, lat) in enumerate(MAP_CHECKINS):
            CheckIn.objects.create(
                unit=map_unit,
                location=Point(lng, lat),
                place=place,
                created_by=user,
                date_created=now - timedelta(days=age_days),
            )

        cache.clear()
        self.stdout.write(
            self.style.SUCCESS(
                f"Seeded {NONGAME_IDENTIFIER} (no game), {GAME_IDENTIFIER} "
                f"(DISTANCE game, id={game.id}) and {MAP_IDENTIFIER} "
                f"({len(MAP_CHECKINS)} check-ins)."
            )
        )
