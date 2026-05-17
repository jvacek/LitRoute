from django.contrib import admin
from django.utils.html import format_html

from backend.models import CheckIn, CheckInImage


@admin.action(description="Send email to followers")
def send_email_to_followers(modeladmin, request, queryset):
    # queryset.update(status="p")
    obj: CheckIn
    for obj in queryset:
        obj.send_email_to_followers()


class CheckInImageInline(admin.TabularInline):
    model = CheckInImage
    extra = 0
    readonly_fields = ["thumbnail"]

    @admin.display(description="Preview")
    def thumbnail(self, obj):
        if obj.pk and obj.image:
            return format_html(
                '<img src="{}" style="height:80px;border-radius:4px;">',
                obj.image.url,
            )
        return "—"


@admin.register(CheckIn)
class CheckInAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "unit",
        "date_created",
        "created_by",
        "place",
        # "image",
        # "message",
        # "location",
    )
    list_filter = ("unit", "date_created", "created_by")
    list_select_related = ("unit", "created_by")
    actions = [send_email_to_followers]
    inlines = [CheckInImageInline]
