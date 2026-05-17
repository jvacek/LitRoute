from django.db import transaction
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from backend.services import send_feedback_emails_task

from .checkin import CheckIn, CheckInImage
from .feedback import Feedback
from .unit import Unit


@receiver(post_save, sender=Unit)
def follow_creator_on_unit_create(sender, instance, created, **kwargs):
    if created:
        instance.followers.add(instance.created_by)


@receiver(post_save, sender=CheckIn)
def send_email_to_followers_signal(sender, instance, created, **kwargs):
    if created:
        instance.send_email_to_followers(**kwargs)


@receiver(post_save, sender=CheckIn)
def invalidate_caches_on_checkin_save(sender, instance, **kwargs):
    from backend.services import invalidate_checkin_caches  # noqa: PLC0415

    invalidate_checkin_caches(instance.unit.identifier, instance.unit.game_id)


@receiver(post_delete, sender=CheckIn)
def invalidate_caches_on_checkin_delete(sender, instance, **kwargs):
    from backend.services import invalidate_checkin_caches  # noqa: PLC0415

    try:
        unit_identifier = instance.unit.identifier
        game_id = instance.unit.game_id
    except Unit.DoesNotExist:
        return
    invalidate_checkin_caches(unit_identifier, game_id)


@receiver(post_delete, sender=CheckInImage)
def delete_checkin_image_file(sender, instance, **kwargs):
    if instance.image:
        from backend.services import delete_checkin_image_file_task  # noqa: PLC0415

        image_name = instance.image.name
        transaction.on_commit(lambda: delete_checkin_image_file_task.delay(image_name))


@receiver(post_save, sender=Feedback)
def send_feedback_emails_signal(sender, instance, created, **kwargs):
    if created:
        send_feedback_emails_task.apply_async(args=[instance.pk])
