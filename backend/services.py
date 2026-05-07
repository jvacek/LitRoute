import logging

from anymail.exceptions import AnymailRequestsAPIError
from celery import Task, shared_task
from celery.utils.log import get_task_logger
from django.core import mail
from geopy.distance import geodesic as distance

from config.constants import (
    EMAIL_TASK_MAX_RETRIES,
    EMAIL_TASK_RETRY_BACKOFF_MAX_SECONDS,
    EMAIL_TASK_RETRY_BACKOFF_SECONDS,
)


class EmailTask(Task):
    autoretry_for = (AnymailRequestsAPIError,)
    retry_kwargs = {"max_retries": EMAIL_TASK_MAX_RETRIES}
    retry_backoff = EMAIL_TASK_RETRY_BACKOFF_SECONDS
    retry_backoff_max = EMAIL_TASK_RETRY_BACKOFF_MAX_SECONDS
    retry_jitter = True


logger = logging.getLogger(__name__)


def unit_distance_cache_key(identifier: str) -> str:
    return f"unit:distance:{identifier}"


def game_leaderboard_cache_key(game_id: int) -> str:
    from config.constants import GAME_LEADERBOARD_CACHE_KEY_PREFIX  # noqa: PLC0415

    return f"{GAME_LEADERBOARD_CACHE_KEY_PREFIX}:{game_id}"


def distance_traveled_in_km(unit) -> float:
    checkins = unit.checkin_set.order_by("date_created")
    # Point.x = longitude, Point.y = latitude; geopy expects (lat, lng) tuples
    pts = [(p.y, p.x) for p in checkins.values_list("location", flat=True)]
    total_distance = sum(distance(pts[i], pts[i + 1]).km for i in range(len(pts) - 1))
    return round(total_distance, 2)


def compute_game_leaderboard(game) -> dict:  # noqa: C901, PLR0912, PLR0915
    """Build the cached leaderboard payload for a Game, with batched distance lookups."""
    from django.core.cache import cache  # noqa: PLC0415
    from django.db.models import Count, OuterRef, Subquery  # noqa: PLC0415
    from django.db.models.functions import Coalesce  # noqa: PLC0415

    from config.constants import GAME_LEADERBOARD_CACHE_TTL, UNIT_DISTANCE_CACHE_TTL  # noqa: PLC0415

    from .models import CheckIn, Game, Unit  # noqa: PLC0415

    cache_key = game_leaderboard_cache_key(game.id)
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    latest_qs = CheckIn.objects.filter(unit=OuterRef("pk")).order_by("-date_created")
    latest_place = latest_qs.values("place")[:1]
    latest_name = latest_qs.annotate(display_name=Coalesce("created_by__name", "anonymous_name")).values(
        "display_name"
    )[:1]

    units_list = list(
        Unit.objects.filter(game=game)
        .select_related("team")
        .annotate(
            cc=Count("checkin", distinct=True),
            latest_place=Subquery(latest_place),
            latest_name=Subquery(latest_name),
        )
    )

    # Batch distance cache lookup — single MGET instead of N individual GETs
    dist_keys = {unit_distance_cache_key(u.identifier): u.identifier for u in units_list}
    cached_dists: dict = cache.get_many(dist_keys.keys()) if dist_keys else {}

    # For cache misses, fetch all checkin points in one DB query
    missing_ids = {ident for key, ident in dist_keys.items() if key not in cached_dists}
    computed_dists: dict[str, float] = {}
    if missing_ids:
        checkins_by_unit: dict[str, list] = {}
        for ident, loc in (
            CheckIn.objects.filter(unit__identifier__in=missing_ids)
            .order_by("unit__identifier", "date_created")
            .values_list("unit__identifier", "location")
        ):
            checkins_by_unit.setdefault(ident, []).append(loc)
        to_cache: dict[str, float] = {}
        for ident in missing_ids:
            pts = [(p.y, p.x) for p in checkins_by_unit.get(ident, [])]
            dist_val = round(sum(distance(pts[i], pts[i + 1]).km for i in range(len(pts) - 1)), 2)
            computed_dists[ident] = dist_val
            to_cache[unit_distance_cache_key(ident)] = dist_val
        if to_cache:
            cache.set_many(to_cache, UNIT_DISTANCE_CACHE_TTL)

    def _get_dist(identifier: str) -> float:
        key = unit_distance_cache_key(identifier)
        return cached_dists[key] if key in cached_dists else computed_dists.get(identifier, 0.0)

    rows = [
        {
            "identifier": u.identifier,
            "place": u.latest_place or "",
            "last_checkin_name": u.latest_name or "",
            "distance_km": _get_dist(u.identifier),
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

    teams_block: list[dict] | None = None
    if any(r["team"] for r in rows):
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
        team_sort = (
            (lambda t: t["checkin_count"]) if game.mode == Game.Modes.HOT_POTATO else (lambda t: t["distance_km"])
        )
        teams_block = sorted(agg.values(), key=team_sort, reverse=True)
        for i, t in enumerate(teams_block, start=1):
            t["rank"] = i
        for t in teams_block:
            t["distance_km"] = round(t["distance_km"], 2)

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
        "teams": teams_block,
    }
    cache.set(cache_key, data, GAME_LEADERBOARD_CACHE_TTL)
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


logger = get_task_logger(__name__)


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
