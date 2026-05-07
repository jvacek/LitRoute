import django.db.models.deletion
import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("backend", "0025_checkin_anonymous_name"),
    ]

    operations = [
        migrations.CreateModel(
            name="Game",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                (
                    "name",
                    models.CharField(
                        help_text="Display name shown on the leaderboard and intro modal.",
                        max_length=100,
                    ),
                ),
                (
                    "mode",
                    models.CharField(
                        choices=[
                            ("relay", "Relay"),
                            ("race", "Race"),
                            ("hot_potato", "Hot Potato"),
                            ("distance", "Distance"),
                        ],
                        default="relay",
                        max_length=20,
                    ),
                ),
                (
                    "start_time",
                    models.DateTimeField(
                        default=django.utils.timezone.now,
                        help_text="When the game starts. End time is start_time + allowed_time hours.",
                    ),
                ),
                (
                    "allowed_time",
                    models.PositiveIntegerField(
                        default=1440,
                        help_text="Total game duration in hours.",
                    ),
                ),
                (
                    "max_gps_drift",
                    models.PositiveIntegerField(
                        default=500,
                        help_text="Maximum allowed GPS drift in meters for check-ins. (Distance+Race modes)",
                    ),
                ),
                (
                    "shelf_life",
                    models.PositiveIntegerField(
                        default=120,
                        help_text="Time in hours before a check-in expires. (Hot Potato mode)",
                    ),
                ),
            ],
        ),
        migrations.AddField(
            model_name="unit",
            name="game",
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, to="backend.game"
            ),
        ),
    ]
