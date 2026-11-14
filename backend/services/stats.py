from django.contrib.auth import get_user_model
from django.contrib.gis.db.models.fields import PointField as GeoPointField
from django.db.models import Count, OuterRef, Subquery

from config.constants import (
    GLOBE_PINS_CACHE_KEY,
    GLOBE_PINS_CACHE_TTL,
    GLOBE_PINS_COUNT,
    STATS_CACHE_KEY,
    STATS_CACHE_TTL,
)

from .cache import cached_with_lock
from .distance import total_distance_traveled_in_km


def get_cached_stats() -> dict:
    return cached_with_lock(STATS_CACHE_KEY, _compute_stats, STATS_CACHE_TTL)


def _compute_stats() -> dict:
    from backend.models import CheckIn, Unit  # noqa: PLC0415

    user_model = get_user_model()

    active_unit_count = (
        Unit.objects.exclude(admin_only_checkin=True)
        .annotate(checkin_count=Count("checkin"))
        .exclude(checkin_count__lt=1)
        .count()
    )
    total_followers = user_model.objects.filter(followed_units__isnull=False).distinct().count()

    return {
        "active_unit_count": active_unit_count,
        "checkin_count": CheckIn.objects.count(),
        "followers": total_followers,
        "total_distance_traveled_km": total_distance_traveled_in_km(),
    }


def get_cached_globe_pins() -> list[dict]:
    return cached_with_lock(GLOBE_PINS_CACHE_KEY, _compute_globe_pins, GLOBE_PINS_CACHE_TTL)


def _compute_globe_pins() -> list[dict]:
    from backend.models import CheckIn, Unit  # noqa: PLC0415

    from .distance import unit_distances_km  # noqa: PLC0415

    # Rank by travelled distance so the globe features the units that have
    # covered the most ground, each pinned at its latest location. Distances
    # come from the per-unit cache — sorting in Python keeps this recompute
    # cheap, since ranking must know every unit's distance and a check-in
    # invalidates this key.
    distances = unit_distances_km()
    latest_location_sq = CheckIn.objects.filter(unit=OuterRef("pk")).order_by("-date_created").values("location")[:1]
    candidates = (
        Unit.objects.exclude(admin_only_checkin=True)
        .annotate(checkin_count=Count("checkin"))
        .exclude(checkin_count__lte=1)
        .annotate(latest_location=Subquery(latest_location_sq, output_field=GeoPointField()))
        .exclude(latest_location__isnull=True)
        .values_list("pk", "latest_location")
    )
    ranked = sorted(candidates, key=lambda row: distances.get(row[0], 0.0), reverse=True)[:GLOBE_PINS_COUNT]
    return [{"lat": loc.y, "lng": loc.x} for _, loc in ranked if loc]
