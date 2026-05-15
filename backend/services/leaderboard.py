from geopy.distance import geodesic as distance

from config.constants import GAME_LEADERBOARD_CACHE_TTL

from .cache import cached_with_lock, game_leaderboard_cache_key


def _aggregate_teams(rows: list[dict], mode: str) -> list[dict] | None:
    """Aggregate per-unit rows into team totals and assign ranks. Returns None if no teams."""
    from backend.models import Game  # noqa: PLC0415

    if not any(r["team"] for r in rows):
        return None

    agg: dict[str, dict] = {}
    for r in rows:
        if not r["team"]:
            continue
        t = agg.setdefault(
            r["team"]["name"],
            {"team": r["team"], "distance_km": 0.0, "checkin_count": 0, "lighter_count": 0},
        )
        t["distance_km"] += r["distance_km"]
        t["checkin_count"] += r["checkin_count"]
        t["lighter_count"] += 1

    sort_key = (lambda t: t["checkin_count"]) if mode == Game.Modes.HOT_POTATO else (lambda t: t["distance_km"])
    teams = sorted(agg.values(), key=sort_key, reverse=True)
    for i, t in enumerate(teams, start=1):
        t["rank"] = i
        t["distance_km"] = round(t["distance_km"], 2)
    return teams


def compute_game_leaderboard(game) -> dict:
    """Build the cached leaderboard payload for a Game.

    Scoring (distance, checkin_count, last seen) caps at game.end_time so the
    leaderboard freezes once the game is over. Pre-start check-ins still
    count — only the upper bound is enforced. The unit-page all-time
    distance (unit_distance_cache_key) is intentionally untouched and
    continues growing as the lighter travels.
    """
    return cached_with_lock(
        game_leaderboard_cache_key(game.id),
        lambda: _build_leaderboard_payload(game),
        GAME_LEADERBOARD_CACHE_TTL,
    )


def _build_leaderboard_payload(game) -> dict:
    from django.db.models import Count, OuterRef, Q, Subquery  # noqa: PLC0415
    from django.db.models.functions import Coalesce  # noqa: PLC0415

    from backend.models import CheckIn, Game, Unit  # noqa: PLC0415

    cutoff = game.end_time

    latest_qs = CheckIn.objects.filter(unit=OuterRef("pk"), date_created__lte=cutoff).order_by("-date_created", "-pk")
    latest_place = latest_qs.values("place")[:1]
    latest_name = latest_qs.annotate(display_name=Coalesce("created_by__name", "anonymous_name")).values(
        "display_name"
    )[:1]

    units_list = list(
        Unit.objects.filter(game=game)
        .select_related("team")
        .annotate(
            cc=Count("checkin", distinct=True, filter=Q(checkin__date_created__lte=cutoff)),
            latest_place=Subquery(latest_place),
            latest_name=Subquery(latest_name),
        )
    )

    # Inline windowed distance calc. We can't reuse unit_distance_cache_key
    # here because that holds all-time totals (correct for the unit page),
    # while the leaderboard needs to freeze at game.end_time. The
    # GAME_LEADERBOARD_CACHE_TTL (5 min) covers load.
    checkins_by_unit: dict[str, list] = {}
    for ident, loc in (
        CheckIn.objects.filter(unit__game=game, date_created__lte=cutoff)
        .order_by("unit__identifier", "date_created")
        .values_list("unit__identifier", "location")
    ):
        checkins_by_unit.setdefault(ident, []).append(loc)

    dist_by_id: dict[str, float] = {}
    for u in units_list:
        pts = [(p.y, p.x) for p in checkins_by_unit.get(u.identifier, [])]
        dist_by_id[u.identifier] = round(
            sum(distance(pts[i], pts[i + 1]).km for i in range(len(pts) - 1)),
            2,
        )

    rows = [
        {
            "identifier": u.identifier,
            "place": u.latest_place or "",
            "last_checkin_name": u.latest_name or "",
            "distance_km": dist_by_id[u.identifier],
            "checkin_count": u.cc,
            "team": {"name": u.team.name, "color": u.team.color} if u.team_id else None,
        }
        for u in units_list
    ]

    # Per-mode sort — hot potato ranks by activity, all others by distance
    if game.mode == Game.Modes.HOT_POTATO:
        sort_field = "checkin_count"
        rows.sort(key=lambda r: r["checkin_count"], reverse=True)
    else:
        sort_field = "distance_km"
        rows.sort(key=lambda r: r["distance_km"], reverse=True)

    for i, row in enumerate(rows, start=1):
        row["rank"] = i

    return {
        "game": {
            "id": game.id,
            "name": game.name,
            "mode": game.mode,
            "allowed_time": game.allowed_time,
            "gps_drift_floor": game.gps_drift_floor,
            "start_time": game.start_time.isoformat(),
            "end_time": game.end_time.isoformat(),
            "sort_by": sort_field,
        },
        "individual": rows,
        "teams": _aggregate_teams(rows, game.mode),
    }
