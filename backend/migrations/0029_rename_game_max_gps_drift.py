from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("backend", "0028_feedback"),
    ]

    operations = [
        migrations.RenameField(
            model_name="game",
            old_name="max_gps_drift",
            new_name="gps_drift_floor",
        ),
        migrations.AlterField(
            model_name="game",
            name="gps_drift_floor",
            field=models.PositiveIntegerField(
                default=500,
                help_text=(
                    "Floor of the drift envelope in meters. The server enforces "
                    "`distance(pin, gps) ≤ max(this, reported accuracy)`, so this is "
                    "the minimum allowance — never the cap. (Distance+Race modes.)"
                ),
            ),
        ),
    ]
