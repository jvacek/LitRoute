from django.db import models
from django.utils import timezone

from config.constants import FEEDBACK_MESSAGE_MAX_LENGTH
from flamerelay.users.models import User


class Feedback(models.Model):
    user = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL)
    email = models.EmailField(blank=True)
    message = models.TextField(max_length=FEEDBACK_MESSAGE_MAX_LENGTH)
    date_created = models.DateTimeField(editable=False, default=timezone.now)

    class Meta:
        ordering = ["-date_created"]

    def __str__(self):
        return f"Feedback {self.pk} from {self.email or 'anonymous'} at {self.date_created!s}"
