from django.core.cache import cache

from config.constants import (
    EXAMPLE_IDENTIFIER,
    UNIT_DISTANCE_CACHE_TTL,
)

from .cache import unit_distance_cache_key


def unit_distances_km() -> dict[int, float]:
    """Map every unit's pk to its travelled distance in km, cache-first.

    Cache-miss units are computed in a single grouped query via
    `Unit.objects.with_distance_km()`. Because a check-in invalidates only its
    own unit's key, a globe/stats recompute after a check-in re-runs geometry
    for that one unit, not the whole table.
    """

    from backend.models import Unit  # noqa: PLC0415

    rows = list(Unit.objects.exclude(identifier=EXAMPLE_IDENTIFIER).values_list("pk", "identifier"))
    keys = {pk: unit_distance_cache_key(ident) for pk, ident in rows}
    cached = cache.get_many(keys.values())

    distances = {pk: cached[k] for pk, k in keys.items() if k in cached}
    missing_pks = [pk for pk, k in keys.items() if k not in cached]
    if missing_pks:
        computed = {u.pk: u.distance_km for u in Unit.objects.filter(pk__in=missing_pks).with_distance_km()}
        cache.set_many({keys[pk]: km for pk, km in computed.items()}, UNIT_DISTANCE_CACHE_TTL)
        distances.update(computed)
    return distances


def total_distance_traveled_in_km() -> float:
    """Sum of per-unit distances, using Redis cache when warm."""
    return round(sum(unit_distances_km().values()), 2)
