"""Backend service layer — caching, computation, and async tasks.

Caching strategy:
    - Custom keys (see `config/constants.py`) read/written via `django.core.cache`.
    - Single-flight protection via `cached_with_lock` for every cold-miss
      compute, so a thundering herd doesn't run the same expensive aggregation
      in parallel.
    - Invalidation is signal-driven: `post_save` / `post_delete` on `CheckIn`
      call `invalidate_checkin_caches` (see `backend/models.py`). View hooks
      do not invalidate directly. Bulk operations that bypass signals
      (`queryset.update`, `bulk_create`, `bulk_update`) must invalidate
      explicitly — see `flamerelay/users/services.py::anonymize_user`.

DRF response caching (`@cache_page`, `@cache_response`) is intentionally not
used: it keys by URL+headers (brittle to invalidate from signals), would
break the leaderboard's `?from=` boundary trick, and would prevent the
journeys endpoint from reusing the leaderboard's cached ranks.
"""

from .cache import (
    cached_with_lock,
    game_journeys_cache_key,
    game_leaderboard_cache_key,
    invalidate_checkin_caches,
    unit_distance_cache_key,
)
from .distance import total_distance_traveled_in_km
from .journeys import compute_game_journeys
from .leaderboard import compute_game_leaderboard
from .stats import get_cached_globe_pins, get_cached_stats
from .tasks import (
    EmailTask,
    cleanup_orphaned_checkin_images,
    cleanup_orphaned_pending_uploads,
    delete_checkin_image_file_task,
    render_thank_you_email,
    send_email_to_followers_task,
    send_feedback_emails_task,
    send_guest_verification_email_task,
    send_thank_you_email_task,
)

__all__ = [
    "EmailTask",
    "cached_with_lock",
    "cleanup_orphaned_checkin_images",
    "cleanup_orphaned_pending_uploads",
    "compute_game_journeys",
    "compute_game_leaderboard",
    "delete_checkin_image_file_task",
    "game_journeys_cache_key",
    "game_leaderboard_cache_key",
    "get_cached_globe_pins",
    "get_cached_stats",
    "invalidate_checkin_caches",
    "render_thank_you_email",
    "send_email_to_followers_task",
    "send_feedback_emails_task",
    "send_guest_verification_email_task",
    "send_thank_you_email_task",
    "total_distance_traveled_in_km",
    "unit_distance_cache_key",
]
