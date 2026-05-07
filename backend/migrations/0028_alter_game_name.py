from django.db import migrations, models


def backfill_game_names(apps, schema_editor):
    Game = apps.get_model("backend", "Game")
    for game in Game.objects.filter(name=""):
        game.name = f"Game {game.id}"
        game.save(update_fields=["name"])


class Migration(migrations.Migration):
    dependencies = [
        ("backend", "0027_game_name"),
    ]

    operations = [
        migrations.RunPython(backfill_game_names, reverse_code=migrations.RunPython.noop),
        migrations.AlterField(
            model_name="game",
            name="name",
            field=models.CharField(
                help_text="Display name shown on the leaderboard and intro modal.",
                max_length=100,
            ),
        ),
    ]
