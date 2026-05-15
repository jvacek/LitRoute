from django import forms
from django.contrib import admin
from django.utils.html import format_html

from backend.models import Game, Team


@admin.register(Game)
class GameAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "mode", "allowed_time", "gps_drift_floor", "shelf_life")
    list_filter = ("mode",)
    search_fields = ("name",)


class TeamAdminForm(forms.ModelForm):
    class Meta:
        model = Team
        fields = ["name", "color"]
        widgets = {"color": forms.TextInput(attrs={"type": "color"})}


@admin.register(Team)
class TeamAdmin(admin.ModelAdmin):
    form = TeamAdminForm
    list_display = ("id", "name", "color_swatch")
    search_fields = ("name",)

    @admin.display(description="Colour")
    def color_swatch(self, obj):
        return format_html(
            '<span style="display:inline-block;width:14px;height:14px;border-radius:3px;'
            'background:{};border:1px solid rgba(0,0,0,0.15);vertical-align:middle;margin-right:6px;"></span>{}',
            obj.color,
            obj.color,
        )
