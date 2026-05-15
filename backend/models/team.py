from django.core.validators import RegexValidator
from django.db import models


class Team(models.Model):
    name = models.SlugField(max_length=32, unique=True)
    color = models.CharField(
        max_length=7,
        default="#7b8fa1",  # smoke
        validators=[RegexValidator(r"^#[0-9a-fA-F]{6}$", "Enter a 6-digit hex colour like #c94c35.")],
        help_text="Hex colour used for the team pill on the leaderboard, e.g. #c94c35.",
    )

    def __str__(self):
        return self.name
