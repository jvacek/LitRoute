from django.conf import settings
from rest_framework import serializers

from flamerelay.users.models import User


class UserSerializer(serializers.ModelSerializer[User]):
    admin_url = serializers.SerializerMethodField()

    def get_admin_url(self, obj: User) -> str | None:
        if obj.is_superuser or obj.is_staff:
            return f"/{settings.ADMIN_URL}"
        return None

    # pyrefly: ignore [bad-override]
    class Meta:
        model = User
        fields = ["username", "name", "language", "receive_ty_emails", "admin_url"]
        read_only_fields = ["username", "admin_url"]
