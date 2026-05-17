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
    return {
        "active_unit_count": Unit.objects.exclude(admin_only_checkin=True)
        .annotate(checkin_count=Count("checkin"))
        .exclude(checkin_count__lt=1)
        .count(),
        "checkin_count": CheckIn.objects.count(),
        "followers": user_model.objects.filter(subscribed_units__isnull=False).distinct().count(),
        "total_distance_traveled_km": total_distance_traveled_in_km(),
    }


def get_cached_globe_pins() -> list[dict]:
    return cached_with_lock(GLOBE_PINS_CACHE_KEY, _compute_globe_pins, GLOBE_PINS_CACHE_TTL)


def _compute_globe_pins() -> list[dict]:

    from backend.models import CheckIn, Unit  # noqa: PLC0415

    latest_location_sq = CheckIn.objects.filter(unit=OuterRef("pk")).order_by("-date_created").values("location")[:1]
    latest_date_sq = CheckIn.objects.filter(unit=OuterRef("pk")).order_by("-date_created").values("date_created")[:1]
    locations = (
        Unit.objects.exclude(admin_only_checkin=True)
        .annotate(checkin_count=Count("checkin"))
        .exclude(checkin_count__lte=1)
        .annotate(latest_location=Subquery(latest_location_sq, output_field=GeoPointField()))
        .annotate(latest_date=Subquery(latest_date_sq))
        .exclude(latest_location__isnull=True)
        .order_by("-latest_date")
        .values_list("latest_location", flat=True)[:GLOBE_PINS_COUNT]
    )
    return [{"lat": loc.y, "lng": loc.x} for loc in locations if loc]
