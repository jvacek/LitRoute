import time

from anymail.exceptions import AnymailRequestsAPIError
from celery import Task, shared_task
from celery.utils.log import get_task_logger
from django.core import mail
from geopy.distance import geodesic as distance

from config.constants import (
    EMAIL_TASK_MAX_RETRIES,
    EMAIL_TASK_RETRY_BACKOFF_MAX_SECONDS,
    EMAIL_TASK_RETRY_BACKOFF_SECONDS,
    GAME_JOURNEYS_CACHE_KEY_PREFIX,
    GAME_JOURNEYS_CACHE_TTL,
    GAME_LEADERBOARD_CACHE_KEY_PREFIX,
    GAME_LEADERBOARD_LOCK_POLL_ATTEMPTS,
    GAME_LEADERBOARD_LOCK_POLL_SECONDS,
    GAME_LEADERBOARD_LOCK_TTL_SECONDS,
    GLOBE_PINS_CACHE_KEY,
    GLOBE_PINS_CACHE_TTL,
    GLOBE_PINS_COUNT,
    STATS_CACHE_KEY,
    STATS_CACHE_TTL,
)

logger = get_task_logger(__name__)


class EmailTask(Task):
    autoretry_for = (AnymailRequestsAPIError,)
    retry_kwargs = {"max_retries": EMAIL_TASK_MAX_RETRIES}
    retry_backoff = EMAIL_TASK_RETRY_BACKOFF_SECONDS
    retry_backoff_max = EMAIL_TASK_RETRY_BACKOFF_MAX_SECONDS
    retry_jitter = True


def unit_distance_cache_key(identifier: str) -> str:
    return f"unit:distance:{identifier}"


def game_leaderboard_cache_key(game_id: int) -> str:
    return f"{GAME_LEADERBOARD_CACHE_KEY_PREFIX}:{game_id}"


def game_journeys_cache_key(game_id: int) -> str:
    return f"{GAME_JOURNEYS_CACHE_KEY_PREFIX}:{game_id}"


def distance_traveled_in_km(unit) -> float:
    checkins = unit.checkin_set.order_by("date_created")
    # Point.x = longitude, Point.y = latitude; geopy expects (lat, lng) tuples
    pts = [(p.y, p.x) for p in checkins.values_list("location", flat=True)]
    total_distance = sum(distance(pts[i], pts[i + 1]).km for i in range(len(pts) - 1))
    return round(total_distance, 2)


def _fetch_unit_journeys(unit_ids: list[int], game_end_time) -> dict[int, list[dict]]:
    """Return a mapping of unit_id → ordered journey points for the given units.

    Each point is `{lng, lat, date, after_end}` where `after_end` flags check-ins
    that happened after the game's `end_time` (still shown so the route stays
    continuous, but the frontend can render them differently).
    """
    from .models import CheckIn  # noqa: PLC0415

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


def _aggregate_teams(rows: list[dict], mode: str) -> list[dict] | None:
    """Aggregate per-unit rows into team totals and assign ranks. Returns None if no teams."""
    from .models import Game  # noqa: PLC0415

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
    from django.core.cache import cache  # noqa: PLC0415

    from config.constants import GAME_LEADERBOARD_CACHE_TTL  # noqa: PLC0415

    cache_key = game_leaderboard_cache_key(game.id)
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    # Single-flight: under a thundering herd on cold cache, only one worker
    # runs the full compute; others poll briefly for the result. cache.add is
    # atomic — returns False if the key already exists.
    lock_key = f"{cache_key}:lock"
    if not cache.add(lock_key, 1, GAME_LEADERBOARD_LOCK_TTL_SECONDS):
        for _ in range(GAME_LEADERBOARD_LOCK_POLL_ATTEMPTS):
            time.sleep(GAME_LEADERBOARD_LOCK_POLL_SECONDS)
            cached = cache.get(cache_key)
            if cached is not None:
                return cached
        # Lock holder hung or crashed — fall through and compute ourselves.

    try:
        return _build_and_cache_leaderboard(game, cache, cache_key, GAME_LEADERBOARD_CACHE_TTL)
    finally:
        cache.delete(lock_key)


def _build_and_cache_leaderboard(game, cache, cache_key: str, ttl: int) -> dict:
    from django.db.models import Count, OuterRef, Q, Subquery  # noqa: PLC0415
    from django.db.models.functions import Coalesce  # noqa: PLC0415

    from .models import CheckIn, Game, Unit  # noqa: PLC0415

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

    data = {
        "game": {
            "id": game.id,
            "name": game.name,
            "mode": game.mode,
            "allowed_time": game.allowed_time,
            "max_gps_drift": game.max_gps_drift,
            "start_time": game.start_time.isoformat(),
            "end_time": game.end_time.isoformat(),
            "sort_by": sort_field,
        },
        "individual": rows,
        "teams": _aggregate_teams(rows, game.mode),
    }
    cache.set(cache_key, data, ttl)
    return data


def compute_game_journeys(game) -> dict:
    """Build the cached journey-map payload for a Game.

    Separate from the leaderboard so the table-only callers (rank lookup on
    the unit page, the leaderboard page itself) don't pay for the full
    coordinate dump on every fetch. Ranks come from the leaderboard so the
    map and table agree on ordering. Anonymous: no unit identifiers in the
    payload (the public endpoint cannot leak slugs).
    """
    from django.core.cache import cache  # noqa: PLC0415

    cache_key = game_journeys_cache_key(game.id)
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    lock_key = f"{cache_key}:lock"
    if not cache.add(lock_key, 1, GAME_LEADERBOARD_LOCK_TTL_SECONDS):
        for _ in range(GAME_LEADERBOARD_LOCK_POLL_ATTEMPTS):
            time.sleep(GAME_LEADERBOARD_LOCK_POLL_SECONDS)
            cached = cache.get(cache_key)
            if cached is not None:
                return cached
        # Lock holder hung or crashed — fall through and compute ourselves.

    try:
        return _build_and_cache_journeys(game, cache, cache_key, GAME_JOURNEYS_CACHE_TTL)
    finally:
        cache.delete(lock_key)


def _build_and_cache_journeys(game, cache, cache_key: str, ttl: int) -> dict:
    from .models import Unit  # noqa: PLC0415

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

    data = {"game_id": game.id, "journeys": entries}
    cache.set(cache_key, data, ttl)
    return data


def total_distance_traveled_in_km() -> float:
    """Sum of per-unit cached distances. Computes and caches any misses individually."""
    from django.core.cache import cache  # noqa: PLC0415

    from .models import Unit  # noqa: PLC0415

    identifiers = list(Unit.objects.values_list("identifier", flat=True))
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


def get_cached_stats() -> dict:
    from django.contrib.auth import get_user_model  # noqa: PLC0415
    from django.core.cache import cache  # noqa: PLC0415
    from django.db.models import Count  # noqa: PLC0415

    from .models import CheckIn, Unit  # noqa: PLC0415

    stats = cache.get(STATS_CACHE_KEY)
    if stats is None:
        user_model = get_user_model()
        stats = {
            "active_unit_count": Unit.objects.exclude(admin_only_checkin=True)
            .annotate(checkin_count=Count("checkin"))
            .exclude(checkin_count__lt=1)
            .count(),
            "checkin_count": CheckIn.objects.count(),
            "contributing_user_count": user_model.objects.annotate(checkin_count=Count("checkin"))
            .filter(checkin_count__gte=1)
            .count(),
            "total_distance_traveled_km": total_distance_traveled_in_km(),
        }
        cache.set(STATS_CACHE_KEY, stats, STATS_CACHE_TTL)
    return stats


def get_cached_globe_pins() -> list[dict]:
    from django.contrib.gis.db.models.fields import PointField as GeoPointField  # noqa: PLC0415
    from django.core.cache import cache  # noqa: PLC0415
    from django.db.models import Count, OuterRef, Subquery  # noqa: PLC0415

    from .models import CheckIn, Unit  # noqa: PLC0415

    pins = cache.get(GLOBE_PINS_CACHE_KEY)
    if pins is None:
        latest_location_sq = (
            CheckIn.objects.filter(unit=OuterRef("pk")).order_by("-date_created").values("location")[:1]
        )
        latest_date_sq = (
            CheckIn.objects.filter(unit=OuterRef("pk")).order_by("-date_created").values("date_created")[:1]
        )
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
        pins = [{"lat": loc.y, "lng": loc.x} for loc in locations if loc]
        cache.set(GLOBE_PINS_CACHE_KEY, pins, GLOBE_PINS_CACHE_TTL)
    return pins


@shared_task(serializer="json")
def delete_checkin_image_file_task(image_name: str) -> None:
    from django.core.files.storage import default_storage  # noqa: PLC0415

    try:
        default_storage.delete(image_name)
    except Exception:
        logger.exception("Failed to delete CheckInImage file: %s", image_name)


@shared_task
def cleanup_orphaned_checkin_images():
    """Delete files in checkins/ storage that have no matching CheckInImage row."""
    from django.core.files.storage import default_storage  # noqa: PLC0415

    from .models import CheckInImage  # noqa: PLC0415

    referenced = set(CheckInImage.objects.values_list("image", flat=True))
    try:
        _, files = default_storage.listdir("checkins/")
    except FileNotFoundError, OSError:
        return 0
    deleted = 0
    for filename in files:
        path = f"checkins/{filename}"
        if path not in referenced:
            default_storage.delete(path)
            deleted += 1
    logger.info("Deleted %d orphaned checkin images", deleted)
    return deleted


@shared_task(base=EmailTask, serializer="json")
def send_email_to_subscribers_task(checkin_id: int):
    from django.contrib.sites.models import Site  # noqa: PLC0415
    from django.template.loader import render_to_string  # noqa: PLC0415
    from django.utils.html import strip_tags  # noqa: PLC0415

    from .models import CheckIn  # noqa: PLC0415

    try:
        checkin = CheckIn.objects.select_related("unit").get(pk=checkin_id)
    except CheckIn.DoesNotExist:
        logger.info("CheckIn %d no longer exists, skipping subscriber emails", checkin_id)
        return

    site = Site.objects.get_current()
    subject = f"LitRoute: New Check In for unit {checkin.unit.identifier}"
    from_email = f"LitRoute <noreply@{site.domain}>"

    messages = []
    subscribers = checkin.unit.subscribers.all()
    if checkin.created_by_id:
        subscribers = subscribers.exclude(pk=checkin.created_by_id)
    for user in subscribers:
        html_message = render_to_string(
            "backend/email_new_checkin.html", {"instance": checkin, "user": user, "site": site}
        )
        messages.append(
            {
                "subject": subject,
                "message": strip_tags(html_message),
                "from_email": from_email,
                "recipient_list": [user.email],
                "html_message": html_message,
            }
        )

    logger.info("Sending %d emails to subscribers for checkin %d", len(messages), checkin_id)
    for message in messages:
        mail.send_mail(**message, fail_silently=False)


def render_thank_you_email(checkin, site) -> str:
    from django.template.loader import render_to_string  # noqa: PLC0415

    return render_to_string("backend/email_thank_you_checkin.html", {"instance": checkin, "site": site})


@shared_task(base=EmailTask, serializer="json")
def send_thank_you_email_task(checkin_id: int):
    from django.contrib.sites.models import Site  # noqa: PLC0415
    from django.utils.html import strip_tags  # noqa: PLC0415

    from .models import CheckIn  # noqa: PLC0415

    try:
        checkin = CheckIn.objects.select_related("unit", "created_by").get(pk=checkin_id)
    except CheckIn.DoesNotExist:
        logger.info("CheckIn %d no longer exists, skipping thank-you email", checkin_id)
        return

    if checkin.created_by_id is None:
        return

    if not checkin.created_by.email:
        logger.info("CheckIn %d creator has no email, skipping thank-you email", checkin_id)
        return

    site = Site.objects.get_current()
    html_message = render_thank_you_email(checkin, site)
    logger.info("Sending thank-you email to %s for checkin %d", checkin.created_by.email, checkin_id)
    mail.send_mail(
        subject=f"Thanks for checking in {checkin.unit.identifier}",
        message=strip_tags(html_message),
        from_email=f"LitRoute <noreply@{site.domain}>",
        recipient_list=[checkin.created_by.email],
        html_message=html_message,
        fail_silently=False,
    )


@shared_task(base=EmailTask, serializer="json")
def send_guest_verification_email_task(token: str, email: str, unit_identifier: str, base_url: str):
    from django.contrib.sites.models import Site  # noqa: PLC0415
    from django.template.loader import render_to_string  # noqa: PLC0415
    from django.utils.html import strip_tags  # noqa: PLC0415

    site = Site.objects.get_current()
    verification_url = f"{base_url}/api/guest-verify/?token={token}"
    html_message = render_to_string(
        "backend/email_guest_verify.html",
        {"unit_identifier": unit_identifier, "verification_url": verification_url, "site": site},
    )
    logger.info("Sending guest verification email to %s for unit %s", email, unit_identifier)
    mail.send_mail(
        subject="Confirm your email for LitRoute updates",
        message=strip_tags(html_message),
        from_email=f"LitRoute <noreply@{site.domain}>",
        recipient_list=[email],
        html_message=html_message,
        fail_silently=False,
    )
