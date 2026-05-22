"""Schedule the orphaned-pending-uploads sweep to run hourly.

Pending CheckInImage rows (checkin IS NULL) that never get attached to a
check-in pile up: a user uploads three photos, closes the tab, the files
sit on disk forever. This task sweeps anything older than
CHECKIN_PENDING_UPLOAD_TTL_HOURS. Matches the pattern set by 0022 for the
health-check task.
"""

from django.db import migrations


def schedule_task(apps, schema_editor):
    IntervalSchedule = apps.get_model("django_celery_beat", "IntervalSchedule")
    PeriodicTask = apps.get_model("django_celery_beat", "PeriodicTask")

    schedule, _ = IntervalSchedule.objects.get_or_create(every=1, period="hours")
    PeriodicTask.objects.get_or_create(
        name="cleanup-orphaned-pending-uploads",
        defaults={
            "task": "backend.services.cleanup_orphaned_pending_uploads",
            "interval": schedule,
        },
    )


def unschedule_task(apps, schema_editor):
    PeriodicTask = apps.get_model("django_celery_beat", "PeriodicTask")
    PeriodicTask.objects.filter(name="cleanup-orphaned-pending-uploads").delete()


class Migration(migrations.Migration):
    dependencies = [
        ("backend", "0032_checkinimage_attach_token_checkinimage_session_key_and_more"),
        ("django_celery_beat", "0019_alter_periodictasks_options"),
    ]

    operations = [
        migrations.RunPython(schedule_task, unschedule_task),
    ]
