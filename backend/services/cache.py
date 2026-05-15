import time

from config.constants import (
    CACHE_SINGLEFLIGHT_LOCK_POLL_ATTEMPTS,
    CACHE_SINGLEFLIGHT_LOCK_POLL_SECONDS,
    CACHE_SINGLEFLIGHT_LOCK_TTL_SECONDS,
    GAME_JOURNEYS_CACHE_KEY_PREFIX,
    GAME_LEADERBOARD_CACHE_KEY_PREFIX,
    GLOBE_PINS_CACHE_KEY,
    STATS_CACHE_KEY,
)


def unit_distance_cache_key(identifier: str) -> str:
    return f"unit:distance:{identifier}"


def game_leaderboard_cache_key(game_id: int) -> str:
    return f"{GAME_LEADERBOARD_CACHE_KEY_PREFIX}:{game_id}"


def game_journeys_cache_key(game_id: int) -> str:
    return f"{GAME_JOURNEYS_CACHE_KEY_PREFIX}:{game_id}"


def cached_with_lock(cache_key: str, compute_fn, ttl: int, *, lock_ttl: int = CACHE_SINGLEFLIGHT_LOCK_TTL_SECONDS):
    """Cache `compute_fn()` under `cache_key` with single-flight protection.

    On cold cache, only one worker runs `compute_fn`; concurrent workers poll
    briefly for the result and fall through to compute themselves if the lock
    holder crashed. `cache.add` is atomic — returns False if the key already
    exists. The lock is released in a `finally` so a crashing computer can't
    permanently wedge readers.
    """
    from django.core.cache import cache  # noqa: PLC0415

    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    lock_key = f"{cache_key}:lock"
    if not cache.add(lock_key, 1, lock_ttl):
        for _ in range(CACHE_SINGLEFLIGHT_LOCK_POLL_ATTEMPTS):
            time.sleep(CACHE_SINGLEFLIGHT_LOCK_POLL_SECONDS)
            cached = cache.get(cache_key)
            if cached is not None:
                return cached
        # Lock holder hung or crashed — fall through and compute ourselves.

    try:
        result = compute_fn()
        cache.set(cache_key, result, ttl)
        return result
    finally:
        cache.delete(lock_key)


def invalidate_checkin_caches(unit_identifier: str, game_id: int | None = None) -> None:
    """Schedule cache invalidations to run after the current transaction commits.

    With ATOMIC_REQUESTS=True the request runs in a transaction. Deleting cache
    entries before commit lets a concurrent reader repopulate them from the
    pre-commit DB state, leaving stale data for the rest of the TTL.
    """
    from django.core.cache import cache  # noqa: PLC0415
    from django.db import transaction  # noqa: PLC0415

    keys = [unit_distance_cache_key(unit_identifier), STATS_CACHE_KEY, GLOBE_PINS_CACHE_KEY]
    if game_id:
        keys.append(game_leaderboard_cache_key(game_id))
        keys.append(game_journeys_cache_key(game_id))
    transaction.on_commit(lambda: cache.delete_many(keys))
