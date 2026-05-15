from django.contrib import admin

from backend.models import Feedback
from config.constants import FEEDBACK_ADMIN_PREVIEW_LENGTH


@admin.register(Feedback)
class FeedbackAdmin(admin.ModelAdmin):
    list_display = ("id", "date_created", "email", "user", "message_preview")
    list_select_related = ("user",)
    search_fields = ("email", "message")
    readonly_fields = ("date_created", "user", "email", "message")

    @admin.display(description="Message")
    def message_preview(self, obj):
        if len(obj.message) > FEEDBACK_ADMIN_PREVIEW_LENGTH:
            return obj.message[:FEEDBACK_ADMIN_PREVIEW_LENGTH] + "…"
        return obj.message

    def has_add_permission(self, request):
        return False
