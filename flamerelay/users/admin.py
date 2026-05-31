from allauth.account.decorators import secure_admin_login
from django import forms
from django.conf import settings
from django.contrib import admin, messages
from django.contrib.admin.widgets import FilteredSelectMultiple
from django.contrib.auth import admin as auth_admin
from django.shortcuts import render
from django.utils.translation import gettext_lazy as _

from backend.models import Unit

from .forms import UserAdminChangeForm, UserAdminCreationForm
from .models import User

if settings.DJANGO_ADMIN_FORCE_ALLAUTH:
    # Force the `admin` sign in process to go through the `django-allauth` workflow:
    # https://docs.allauth.org/en/latest/common/admin.html#admin
    admin.autodiscover()
    admin.site.login = secure_admin_login(admin.site.login)  # type: ignore[method-assign]


class ManageFollowedUnitsForm(forms.Form):
    units = forms.ModelMultipleChoiceField(
        queryset=Unit.objects.order_by("identifier"),
        widget=FilteredSelectMultiple("lighters", is_stacked=False),
        label="Lighters",
    )


@admin.register(User)
class UserAdmin(auth_admin.UserAdmin):
    form = UserAdminChangeForm
    add_form = UserAdminCreationForm
    fieldsets = (
        (None, {"fields": ("username", "password")}),
        (_("Personal info"), {"fields": ("name", "email")}),
        (
            _("Permissions"),
            {
                "fields": (
                    "is_active",
                    "is_staff",
                    "is_superuser",
                    "groups",
                    "user_permissions",
                ),
            },
        ),
        (_("Important dates"), {"fields": ("last_login", "date_joined")}),
    )
    list_display = ["username", "name", "is_superuser"]
    search_fields = ["name"]
    actions = ["add_followed_units", "remove_followed_units"]

    @admin.action(description="Make selected users follow lighters…")
    def add_followed_units(self, request, queryset):
        return self._manage_followed_units(request, queryset, add=True)

    @admin.action(description="Make selected users unfollow lighters…")
    def remove_followed_units(self, request, queryset):
        return self._manage_followed_units(request, queryset, add=False)

    def _manage_followed_units(self, request, queryset, *, add):
        action_name = "add_followed_units" if add else "remove_followed_units"
        if "apply" in request.POST:
            form = ManageFollowedUnitsForm(request.POST)
            if form.is_valid():
                units = form.cleaned_data["units"]
                for user in queryset:
                    (user.followed_units.add if add else user.followed_units.remove)(*units)
                verb = "added to" if add else "removed from"
                self.message_user(
                    request,
                    f"{queryset.count()} user(s) {verb} the followers of {len(units)} lighter(s).",
                    level=messages.SUCCESS,
                )
                return None
        else:
            form = ManageFollowedUnitsForm()
        context = {
            **self.admin_site.each_context(request),
            "title": "Follow lighters" if add else "Unfollow lighters",
            "opts": self.opts,
            "users": queryset,
            "form": form,
            "action_name": action_name,
            "action_checkbox_name": admin.helpers.ACTION_CHECKBOX_NAME,
            "selected_ids": queryset.values_list("pk", flat=True),
        }
        return render(request, "admin/users/user/manage_followed_undoits.html", context)
