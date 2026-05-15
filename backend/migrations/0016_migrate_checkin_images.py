from django.db import migrations


def forward(apps, schema_editor):
    CheckIn = apps.get_model("backend", "CheckIn")
    CheckInImage = apps.get_model("backend", "CheckInImage")
    for checkin in CheckIn.objects.exclude(image="").exclude(image=None):
        CheckInImage.objects.create(checkin=checkin, image=checkin.image, order=0)


def backward(apps, schema_editor):
    CheckInImage = apps.get_model("backend", "CheckInImage")
    for img in CheckInImage.objects.select_related("checkin").filter(order=0):
        img.checkin.image = img.image
        img.checkin.save(update_fields=["image"])
    CheckInImage.objects.all().delete()


class Migration(migrations.Migration):
    dependencies = [
        ("backend", "0015_checkinimage"),
    ]

    operations = [
        migrations.RunPython(forward, backward),
    ]
