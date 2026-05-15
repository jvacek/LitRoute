from django.db import migrations


def create_contributor_group(apps, schema_editor):
    from django.apps import apps as global_apps  # noqa: PLC0415
    from django.contrib.auth.management import create_permissions  # noqa: PLC0415
    from django.contrib.contenttypes.management import create_contenttypes  # noqa: PLC0415

    app_config = global_apps.get_app_config("backend")
    create_contenttypes(app_config, verbosity=0)
    create_permissions(app_config, verbosity=0)

    Group = apps.get_model("auth", "Group")
    Permission = apps.get_model("auth", "Permission")
    ContentType = apps.get_model("contenttypes", "ContentType")

    content_type = ContentType.objects.get(app_label="backend", model="unit")
    perms = Permission.objects.filter(
        content_type=content_type,
        codename__in=["add_unit", "change_unit", "view_unit"],
    )
    group, _ = Group.objects.get_or_create(name="contributor")
    group.permissions.set(perms)


def remove_contributor_group(apps, schema_editor):
    Group = apps.get_model("auth", "Group")
    Group.objects.filter(name="contributor").delete()


class Migration(migrations.Migration):
    dependencies = [
        ("backend", "0013_alter_checkin_unit"),
    ]

    operations = [
        migrations.RunPython(create_contributor_group, remove_contributor_group),
    ]
