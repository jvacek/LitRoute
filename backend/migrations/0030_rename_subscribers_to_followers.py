from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("backend", "0029_rename_game_max_gps_drift"),
    ]

    operations = [
        migrations.RenameField(
            model_name="unit",
            old_name="subscribers",
            new_name="followers",
        ),
        migrations.AlterField(
            model_name="unit",
            name="followers",
            field=models.ManyToManyField(blank=True, related_name="followed_units", to=settings.AUTH_USER_MODEL),
        ),
    ]
