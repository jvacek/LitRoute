from django.contrib import admin
from django.db.models import Count
from django.utils.html import format_html_join

from backend.models import CheckIn, Unit


class CheckInInline(admin.TabularInline):
    model = CheckIn
    extra = 0
    readonly_fields = ["photos"]

    @admin.display(description="Photos")
    def photos(self, obj):
        images = obj.images.all()[:5]
        if not images:
            return "—"
        return format_html_join(
            "",
            '<img src="{}" style="height:56px;border-radius:4px;margin-right:4px;">',
            ((img.image.url,) for img in images),
        )


@admin.register(Unit)
class UnitAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "identifier",
        "date_created",
        "created_by",
        "team",
        "subscriber_count",
        "checkin_count",
    )
    list_filter = ("date_created", "created_by", "team")
    list_select_related = ("team", "created_by")
    filter_horizontal = ["subscribers"]
    inlines = [CheckInInline]

    @admin.display(description="Subscribers", ordering="subscriber_count")
    def subscriber_count(self, obj):
        return obj.subscriber_count

    @admin.display(description="Check-ins", ordering="checkin_count")
    def checkin_count(self, obj):
        return obj.checkin_count

    def _is_contributor(self, request):
        return not request.user.is_superuser and request.user.groups.filter(name="contributor").exists()

    def get_readonly_fields(self, request, obj=None):
        if self._is_contributor(request):
            fields = ["created_by"]
            if obj is not None and obj.checkin_set.exists():
                fields.append("identifier")
            return fields
        return []

    def has_delete_permission(self, request, obj=None):
        if self._is_contributor(request):
            # obj=None means the changelist bulk-delete action — disallow it
            return obj is not None and not obj.checkin_set.exists()
        return super().has_delete_permission(request, obj)

    def get_exclude(self, request, obj=None):
        if self._is_contributor(request):
            return ["subscribers"]
        return super().get_exclude(request, obj)

    def get_list_filter(self, request):
        if self._is_contributor(request):
            return ["date_created", "team"]
        return ["date_created", "created_by", "team"]

    def get_queryset(self, request):
        qs = (
            super()
            .get_queryset(request)
            .annotate(
                subscriber_count=Count("subscribers", distinct=True),
                checkin_count=Count("checkin", distinct=True),
            )
        )
        if self._is_contributor(request):
            return qs.filter(created_by=request.user)
        return qs

    def get_fieldsets(self, request, obj=None):
        if not self._is_contributor(request):
            return super().get_fieldsets(request, obj)
        description = (
            "You can only see and edit units you created. "
            "Once a unit has a check-in, its identifier is locked and the unit cannot be deleted. "
            "Units with no check-ins can be deleted from this page."
        )
        return [
            (
                None,
                {
                    "fields": ["identifier", "team", "game", "admin_only_checkin", "created_by"],
                    "description": description,
                },
            )
        ]

    def changelist_view(self, request, extra_context=None):
        extra_context = extra_context or {}
        extra_context["is_contributor"] = self._is_contributor(request)
        return super().changelist_view(request, extra_context)

    def get_changeform_initial_data(self, request):
        initial = super().get_changeform_initial_data(request)
        initial.setdefault("created_by", request.user.pk)
        return initial

    def save_model(self, request, obj, form, change):
        if not change and not obj.created_by_id:
            obj.created_by = request.user
        super().save_model(request, obj, form, change)

    def save_related(self, request, form, formsets, change):
        super().save_related(request, form, formsets, change)
        if not change and form.instance.created_by_id:
            form.instance.subscribers.add(form.instance.created_by_id)
