from geopy.distance import geodesic as distance

from config.constants import EXAMPLE_IDENTIFIER

from .cache import unit_distance_cache_key


def distance_traveled_in_km(unit) -> float:
    checkins = unit.checkin_set.order_by("date_created")
    # Point.x = longitude, Point.y = latitude; geopy expects (lat, lng) tuples
    pts = [(p.y, p.x) for p in checkins.values_list("location", flat=True)]
    total_distance = sum(distance(pts[i], pts[i + 1]).km for i in range(len(pts) - 1))
    return round(total_distance, 2)


def total_distance_traveled_in_km() -> float:
    """Sum of per-unit cached distances. Computes and caches any misses individually."""
    from django.core.cache import cache  # noqa: PLC0415

    from backend.models import Unit  # noqa: PLC0415

    units = Unit.objects.exclude(identifier=EXAMPLE_IDENTIFIER)
    identifiers = list(units.values_list("identifier", flat=True))
    keys = {unit_distance_cache_key(i): i for i in identifiers}
    cached = cache.get_many(keys.keys())

    total = sum(cached.values())

    missing = {i for k, i in keys.items() if k not in cached}
    if missing:
        to_set = {}
        for unit in Unit.objects.filter(identifier__in=missing):
            dist = distance_traveled_in_km(unit)
            to_set[unit_distance_cache_key(unit.identifier)] = dist
            total += dist
        from config.constants import UNIT_DISTANCE_CACHE_TTL  # noqa: PLC0415

        cache.set_many(to_set, UNIT_DISTANCE_CACHE_TTL)

    return round(total, 2)
