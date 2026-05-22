from anymail.exceptions import AnymailRequestsAPIError
from celery import Task, shared_task
from celery.utils.log import get_task_logger
from django.contrib.auth import get_user_model
from django.contrib.sites.models import Site
from django.core import mail
from django.core.files.storage import default_storage
from django.template.loader import render_to_string
from django.utils.html import strip_tags

from config.constants import (
    CHECKIN_PENDING_UPLOAD_CLEANUP_BATCH_SIZE,
    CHECKIN_PENDING_UPLOAD_TTL_HOURS,
    EMAIL_TASK_MAX_RETRIES,
    EMAIL_TASK_RETRY_BACKOFF_MAX_SECONDS,
    EMAIL_TASK_RETRY_BACKOFF_SECONDS,
)

logger = get_task_logger(__name__)


class EmailTask(Task):
    autoretry_for = (AnymailRequestsAPIError,)
    retry_kwargs = {"max_retries": EMAIL_TASK_MAX_RETRIES}
    retry_backoff = EMAIL_TASK_RETRY_BACKOFF_SECONDS
    retry_backoff_max = EMAIL_TASK_RETRY_BACKOFF_MAX_SECONDS
    retry_jitter = True


@shared_task(name="backend.services.delete_checkin_image_file_task", serializer="json")
def delete_checkin_image_file_task(image_name: str) -> None:

    try:
        default_storage.delete(image_name)
    except Exception:
        logger.exception("Failed to delete CheckInImage file: %s", image_name)


@shared_task(name="backend.services.cleanup_orphaned_checkin_images")
def cleanup_orphaned_checkin_images():
    """Delete files in checkins/ storage that have no matching CheckInImage row."""

    from backend.models import CheckInImage  # noqa: PLC0415

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


@shared_task(name="backend.services.cleanup_orphaned_pending_uploads")
def cleanup_orphaned_pending_uploads():
    """Delete pending CheckInImage rows that were never attached to a CheckIn.

    Race-safe against concurrent `attach_pending`:
      - `select_for_update(skip_locked=True)` skips rows currently held by
        an attach UPDATE, so cleanup never blocks the live request path.
        Skipped rows will be picked up next run (if still pending).
      - The DELETE re-checks `checkin__isnull=True` + `uploaded_at__lt` so
        a row that *was* claimed between the SELECT and the DELETE is
        excluded — never deletes a freshly-attached row.

    The existing `post_delete` signal on CheckInImage fires per-row and
    schedules `delete_checkin_image_file_task` to remove the file via
    `transaction.on_commit`, so we get storage cleanup for free.
    """

    from datetime import timedelta  # noqa: PLC0415

    from django.db import transaction  # noqa: PLC0415
    from django.utils import timezone  # noqa: PLC0415

    from backend.models import CheckInImage  # noqa: PLC0415

    cutoff = timezone.now() - timedelta(hours=CHECKIN_PENDING_UPLOAD_TTL_HOURS)
    total_deleted = 0
    while True:
        with transaction.atomic():
            candidate_ids = list(
                CheckInImage.objects.select_for_update(skip_locked=True)
                .filter(checkin__isnull=True, uploaded_at__lt=cutoff)
                .values_list("id", flat=True)[:CHECKIN_PENDING_UPLOAD_CLEANUP_BATCH_SIZE]
            )
            if not candidate_ids:
                break
            deleted, _ = CheckInImage.objects.filter(
                id__in=candidate_ids,
                checkin__isnull=True,
                uploaded_at__lt=cutoff,
            ).delete()
            total_deleted += deleted
    if total_deleted:
        logger.info("Deleted %d orphaned pending uploads", total_deleted)
    return total_deleted


@shared_task(name="backend.services.send_email_to_followers_task", base=EmailTask, serializer="json")
def send_email_to_followers_task(checkin_id: int):

    from backend.models import CheckIn  # noqa: PLC0415

    try:
        checkin = CheckIn.objects.select_related("unit").get(pk=checkin_id)
    except CheckIn.DoesNotExist:
        logger.info("CheckIn %d no longer exists, skipping follower emails", checkin_id)
        return

    site = Site.objects.get_current()
    subject = f"LitRoute: New Check In for unit {checkin.unit.identifier}"
    from_email = f"LitRoute <noreply@{site.domain}>"

    messages = []
    followers = checkin.unit.followers.all()
    if checkin.created_by_id:
        followers = followers.exclude(pk=checkin.created_by_id)
    for user in followers:
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

    logger.info("Sending %d emails to followers for checkin %d", len(messages), checkin_id)
    for message in messages:
        mail.send_mail(**message, fail_silently=False)


def render_thank_you_email(checkin, site) -> str:

    return render_to_string("backend/email_thank_you_checkin.html", {"instance": checkin, "site": site})


@shared_task(name="backend.services.send_thank_you_email_task", base=EmailTask, serializer="json")
def send_thank_you_email_task(checkin_id: int):

    from backend.models import CheckIn  # noqa: PLC0415

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


@shared_task(name="backend.services.send_guest_verification_email_task", base=EmailTask, serializer="json")
def send_guest_verification_email_task(token: str, email: str, unit_identifier: str, base_url: str):

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


@shared_task(name="backend.services.send_feedback_emails_task", base=EmailTask, serializer="json")
def send_feedback_emails_task(feedback_id: int):

    from backend.models import Feedback  # noqa: PLC0415

    try:
        feedback = Feedback.objects.select_related("user").get(pk=feedback_id)
    except Feedback.DoesNotExist:
        logger.info("Feedback %d no longer exists, skipping emails", feedback_id)
        return

    site = Site.objects.get_current()
    from_email = f"LitRoute <noreply@{site.domain}>"

    User = get_user_model()  # noqa: N806
    admin_emails = list(
        User.objects.filter(is_superuser=True, is_active=True).exclude(email="").values_list("email", flat=True)
    )
    if admin_emails:
        submitter = feedback.email or "anonymous"
        if feedback.user_id:
            submitter = f"{feedback.user} ({feedback.email})"
        admin_body = f"From: {submitter}\nSubmitted: {feedback.date_created}\n\n{feedback.message}\n"
        admin_subject = f"LitRoute feedback from {feedback.email or 'anonymous'}"
        logger.info("Sending feedback %d to %d admin(s)", feedback_id, len(admin_emails))
        mail.send_mail(
            subject=admin_subject,
            message=admin_body,
            from_email=from_email,
            recipient_list=admin_emails,
            fail_silently=False,
        )

    if feedback.email:
        html_message = render_to_string(
            "backend/email_feedback_thank_you.html",
            {"instance": feedback, "site": site},
        )
        logger.info("Sending feedback thank-you to %s", feedback.email)
        mail.send_mail(
            subject="LitRoute: Thanks for your feedback",
            message=strip_tags(html_message),
            from_email=from_email,
            recipient_list=[feedback.email],
            html_message=html_message,
            fail_silently=False,
        )
