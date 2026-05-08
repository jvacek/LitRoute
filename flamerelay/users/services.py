from __future__ import annotations

import logging
import uuid

from allauth.account.models import EmailAddress
from allauth.mfa.models import Authenticator
from allauth.socialaccount.models import SocialAccount
from celery import shared_task
from django.core import mail
from django.core.files.storage import default_storage
from django.db import transaction

from backend.models import CheckIn, CheckInImage

logger = logging.getLogger(__name__)

_REMOVED_ITEMS = [
    "Your email address and sign-in methods",
    "Your name and profile information",
    "All photos you uploaded to check-ins",
    "All messages you left on check-ins",
    "Your unit subscriptions",
]


@shared_task(serializer="json")
def send_account_deletion_email_task(email: str) -> None:
    from django.contrib.sites.models import Site  # noqa: PLC0415
    from django.template.loader import render_to_string  # noqa: PLC0415
    from django.utils.html import strip_tags  # noqa: PLC0415

    site = Site.objects.get_current()
    html_message = render_to_string(
        "backend/email_account_deleted.html",
        {"email": email, "removed_items": _REMOVED_ITEMS, "site": site},
    )
    logger.info("Sending account deletion confirmation to %s", email)
    mail.send_mail(
        subject="Your LitRoute account has been deleted",
        message=strip_tags(html_message),
        from_email=f"LitRoute <noreply@{site.domain}>",
        recipient_list=[email],
        html_message=html_message,
        fail_silently=False,
    )


def anonymize_user(user) -> None:
    from django.core.cache import cache  # noqa: PLC0415

    from backend.services import game_journeys_cache_key, game_leaderboard_cache_key  # noqa: PLC0415

    email = user.email

    image_names = list(CheckInImage.objects.filter(checkin__created_by=user).values_list("image", flat=True))

    # Capture before mutating: queryset.update + user.save below bypass the
    # CheckIn post_save signal, so we invalidate per-game leaderboard /
    # journeys caches explicitly. The leaderboard's `latest_name` reads
    # `Coalesce(created_by__name, anonymous_name)`, which changes when
    # user.name flips to "".
    affected_game_ids = list(
        CheckIn.objects.filter(created_by=user, unit__game__isnull=False)
        .values_list("unit__game_id", flat=True)
        .distinct()
    )

    with transaction.atomic():
        anon_id = uuid.uuid4().hex
        user.email = f"deleted_{anon_id}@deleted.invalid"
        user.username = f"deleted_{anon_id}"
        user.name = ""
        user.is_active = False
        user.set_unusable_password()
        user.save()

        EmailAddress.objects.filter(user=user).delete()
        SocialAccount.objects.filter(user=user).delete()
        Authenticator.objects.filter(user=user).delete()

        CheckInImage.objects.filter(checkin__created_by=user).delete()
        CheckIn.objects.filter(created_by=user).update(message="")
        user.subscribed_units.clear()

        if affected_game_ids:
            keys = [
                k for gid in affected_game_ids for k in (game_leaderboard_cache_key(gid), game_journeys_cache_key(gid))
            ]
            transaction.on_commit(lambda: cache.delete_many(keys))

        transaction.on_commit(lambda: send_account_deletion_email_task.delay(email))

    # File deletion is intentionally outside the transaction: storage ops are
    # non-transactional. Any failures here leave the file unreferenced in the DB
    # (deleted above), so cleanup_orphaned_checkin_images will GC them on next run.
    for image_name in image_names:
        try:
            default_storage.delete(image_name)
        except Exception:
            logger.exception("Failed to delete anonymized checkin image: %s", image_name)
