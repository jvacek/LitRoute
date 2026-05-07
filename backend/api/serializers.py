from datetime import timedelta

from django.utils import timezone
from rest_framework import serializers
from rest_framework_gis.fields import GeometryField

from backend.models import CheckIn, CheckInImage, Game, Team, Unit
from config.constants import CHECKIN_EDIT_GRACE_PERIOD_HOURS


class CheckInImageSerializer(serializers.ModelSerializer):
    class Meta:
        model = CheckInImage
        fields = ["id", "image", "order"]


class CheckInSerializer(serializers.ModelSerializer):
    within_edit_grace_period = serializers.SerializerMethodField()
    created_by_username = serializers.SerializerMethodField()
    created_by_name = serializers.SerializerMethodField()
    images = CheckInImageSerializer(many=True, read_only=True)
    location = GeometryField()

    class Meta:
        model = CheckIn
        fields = [
            "id",
            "date_created",
            "created_by_username",
            "created_by_name",
            "images",
            "message",
            "place",
            "location",
            "within_edit_grace_period",
            "anonymous_name",
        ]
        read_only_fields = [
            "id",
            "date_created",
            "created_by_username",
            "created_by_name",
            "within_edit_grace_period",
            "images",
        ]

    def update(self, instance, validated_data):
        validated_data.pop("location", None)
        return super().update(instance, validated_data)

    def get_created_by_username(self, obj: CheckIn) -> str | None:
        return obj.created_by.username if obj.created_by_id else None

    def get_created_by_name(self, obj: CheckIn) -> str | None:
        if obj.created_by_id:
            return obj.created_by.name
        return obj.anonymous_name or None

    def get_within_edit_grace_period(self, obj: CheckIn) -> bool:
        return obj.date_created >= timezone.now() - timedelta(hours=CHECKIN_EDIT_GRACE_PERIOD_HOURS)


class GameSerializer(serializers.ModelSerializer):
    end_time = serializers.DateTimeField(read_only=True)

    class Meta:
        model = Game
        fields = [
            "id",
            "name",
            "mode",
            "allowed_time",
            "max_gps_drift",
            "shelf_life",
            "start_time",
            "end_time",
        ]


class TeamSerializer(serializers.ModelSerializer):
    class Meta:
        model = Team
        fields = ["name", "color"]


class UnitSerializer(serializers.ModelSerializer):
    checkin_count = serializers.IntegerField(read_only=True)
    subscriber_count = serializers.IntegerField(read_only=True)
    distance_traveled_km = serializers.SerializerMethodField()
    is_subscribed = serializers.SerializerMethodField()
    can_check_in = serializers.SerializerMethodField()
    is_gps_enforced = serializers.SerializerMethodField()
    team = TeamSerializer(read_only=True)
    game = GameSerializer(read_only=True)
    game_rank = serializers.SerializerMethodField()
    game_total = serializers.SerializerMethodField()

    class Meta:
        model = Unit
        fields = [
            "identifier",
            "date_created",
            "admin_only_checkin",
            "team",
            "checkin_count",
            "subscriber_count",
            "distance_traveled_km",
            "is_subscribed",
            "can_check_in",
            "is_gps_enforced",
            "game",
            "game_rank",
            "game_total",
        ]

    def get_distance_traveled_km(self, obj: Unit) -> float:
        return obj.get_distance_traveled()

    def get_is_subscribed(self, obj: Unit) -> bool:
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            return obj.subscribers.filter(id=request.user.id).exists()
        return False

    def get_can_check_in(self, obj: Unit) -> bool:
        request = self.context.get("request")
        if obj.admin_only_checkin:
            return bool(
                request and request.user.is_authenticated and (request.user.is_superuser or request.user.is_staff)
            )
        if not request or not request.user.is_authenticated:
            return True
        return obj.can_user_check_in(request.user)

    def get_is_gps_enforced(self, obj: Unit) -> bool:
        return obj.is_gps_enforced

    def get_game_rank(self, obj: Unit) -> int | None:
        if not obj.game_id:
            return None
        from backend.services import get_cached_game_rank  # noqa: PLC0415

        return get_cached_game_rank(obj.game_id, obj.identifier)

    def get_game_total(self, obj: Unit) -> int | None:
        if not obj.game_id:
            return None
        return obj.game_total
