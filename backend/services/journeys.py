from config.constants import GAME_JOURNEYS_CACHE_TTL

from .cache import cached_with_lock, game_journeys_cache_key
from .leaderboard import compute_game_leaderboard


def _fetch_unit_journeys(unit_ids: list[int], game_end_time) -> dict[int, list[dict]]:
    """Return a mapping of unit_id → ordered journey points for the given units.

    Each point is `{lng, lat, date, after_end}` where `after_end` flags check-ins
    that happened after the game's `end_time` (still shown so the route stays
    continuous, but the frontend can render them differently).
    """
    from backend.models import CheckIn  # noqa: PLC0415

    if not unit_ids:
        return {}

    journeys: dict[int, list[dict]] = {uid: [] for uid in unit_ids}
    for unit_id, location, date_created in (
        CheckIn.objects.filter(unit_id__in=unit_ids)
        .order_by("unit_id", "date_created")
        .values_list("unit_id", "location", "date_created")
    ):
        journeys[unit_id].append(
            {
                "lng": location.x,
                "lat": location.y,
                "date": date_created.isoformat(),
                "after_end": date_created > game_end_time,
            }
        )
    return journeys


def compute_game_journeys(game) -> dict:
    """Build the cached journey-map payload for a Game.

    Separate from the leaderboard so the table-only callers (rank lookup on
    the unit page, the leaderboard page itself) don't pay for the full
    coordinate dump on every fetch. Anonymous: no unit identifiers in the
    payload (the public endpoint cannot leak slugs).
    """
    return cached_with_lock(
        game_journeys_cache_key(game.id),
        lambda: _build_journeys_payload(game),
        GAME_JOURNEYS_CACHE_TTL,
    )


def _build_journeys_payload(game) -> dict:
    from backend.models import Unit  # noqa: PLC0415

    # Re-enter the leaderboard cache for ranks. Intentional: guarantees the
    # map and table agree on ordering, and lets a warm leaderboard cache
    # short-circuit the recursion.
    leaderboard = compute_game_leaderboard(game)
    rank_by_identifier = {row["identifier"]: row["rank"] for row in leaderboard["individual"]}

    units = list(Unit.objects.filter(game=game).select_related("team").only("id", "identifier", "team"))
    journeys_by_id = _fetch_unit_journeys([u.id for u in units], game.end_time)

    entries = []
    for u in units:
        rank = rank_by_identifier.get(u.identifier)
        if rank is None:
            continue  # unit isn't on the leaderboard (shouldn't happen, but defend)
        entries.append(
            {
                "rank": rank,
                "team": {"name": u.team.name, "color": u.team.color} if u.team_id else None,
                "journey": journeys_by_id.get(u.id, []),
            }
        )
    entries.sort(key=lambda e: e["rank"])

    return {"game_id": game.id, "journeys": entries}
