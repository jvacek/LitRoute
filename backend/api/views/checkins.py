import json
import uuid
from datetime import timedelta

from django.shortcuts import get_object_or_404
from django.utils import timezone
from geopy.distance import geodesic
from rest_framework import serializers, status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.mixins import (
    CreateModelMixin,
    DestroyModelMixin,
    ListModelMixin,
    UpdateModelMixin,
)
from rest_framework.permissions import AllowAny, IsAuthenticatedOrReadOnly
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet

from backend.api.serializers import CheckInSerializer
from backend.models import CheckIn, CheckInImage, Unit
from config.constants import (
    CHECKIN_DELETE_GRACE_PERIOD_HOURS,
    CHECKIN_EDIT_GRACE_PERIOD_HOURS,
    CHECKIN_MAX_IMAGES,
    CHECKIN_MAX_IMPLIED_SPEED_KMH,
    GAME_CHECKIN_MIN_GAP_SECONDS,
    MIN_GAME_REQUIRED_NAME_CHARS,
    MIN_GAME_REQUIRED_WORD_CHARS,
)

from . import _helpers
from ._helpers import _LETTER_OR_DIGIT_RE


class CheckInViewSet(ListModelMixin, CreateModelMixin, UpdateModelMixin, DestroyModelMixin, GenericViewSet):
    serializer_class = CheckInSerializer
    permission_classes = [IsAuthenticatedOrReadOnly]

    def _verify_game_required_fields(self, unit: Unit, validated_data) -> None:
        """For game-enforced units, require a real `place` (everyone) and a real
        `anonymous_name` (anon only) so leaderboard rows can be attributed.
        Mirrors the frontend's MIN_REQUIRED_WORD_CHARS check — savvy clients
        could otherwise bypass it via curl."""
        if not unit.is_gps_enforced:
            return
        errors: dict[str, list[str]] = {}
        place = validated_data.get("place") or ""
        if len(_LETTER_OR_DIGIT_RE.findall(place)) < MIN_GAME_REQUIRED_WORD_CHARS:
            errors["place"] = [
                f"Place is required ({MIN_GAME_REQUIRED_WORD_CHARS}+ letters or digits) "
                "so this check-in can be attributed on the leaderboard.",
            ]
        if not self.request.user.is_authenticated:
            anon_name = validated_data.get("anonymous_name") or ""
            # Single letter/digit is enough — initials and CJK single-glyph
            # names are legitimate.
            if len(_LETTER_OR_DIGIT_RE.findall(anon_name)) < MIN_GAME_REQUIRED_NAME_CHARS:
                errors["anonymous_name"] = [
                    "Name is required so this check-in can be attributed on the leaderboard.",
                ]
        if errors:
            raise ValidationError(errors)

    def get_permissions(self):
        if self.action in ("create", "destroy", "partial_update"):
            return [AllowAny()]
        return super().get_permissions()

    def get_queryset(self):
        return CheckIn.objects.filter(unit__identifier=self.kwargs["identifier"])

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        checkin = serializer.instance
        data = serializer.data
        if not request.user.is_authenticated and checkin.edit_token:
            data = {**data, "edit_token": str(checkin.edit_token)}
        headers = self.get_success_headers(data)
        return Response(data, status=status.HTTP_201_CREATED, headers=headers)

    def _verify_can_check_in(self, unit: Unit) -> None:
        """Permission gate. Runs before any single-use token is consumed so a 403
        doesn't force the user to recapture GPS."""
        if self.request.user.is_authenticated:
            if unit.admin_only_checkin and not (self.request.user.is_superuser or self.request.user.is_staff):
                msg = "This unit can only be checked in by admins."
                raise PermissionDenied(msg)
            if not unit.can_user_check_in(self.request.user):
                msg = (
                    "You can't check in here — once someone else takes the lighter, "
                    "its journey moves on. You can still follow along by subscribing."
                )
                raise PermissionDenied(msg)
        elif unit.admin_only_checkin:
            msg = "This unit can only be checked in by admins."
            raise PermissionDenied(msg)

    def _check_anon_captcha(self) -> None:
        """Anon-only Turnstile check."""
        if self.request.user.is_authenticated:
            return
        turnstile_token = self.request.data.get("turnstile_token", "")
        remote_ip = self.request.headers.get("cf-connecting-ip") or self.request.META.get("REMOTE_ADDR", "")
        if not _helpers._verify_turnstile(turnstile_token, remote_ip):  # noqa: SLF001
            raise serializers.ValidationError({"captcha": ["Captcha verification failed. Please try again."]})

    def _verify_gps_drift(self, unit: Unit, validated_data) -> None:
        """Game-mode units must submit a device-reported GPS coordinate plus
        an accuracy radius. We accept the pin if it sits inside either the
        game's configured drift envelope OR the user's own reported accuracy
        circle — whichever is larger. The accuracy fallback means honest users
        with coarse Wi-Fi/cell fixes can still drop the pin where they
        actually are, while clean fixes stay tightly bounded."""
        if not unit.is_gps_enforced:
            return
        gps_location = validated_data.get("gps_location")
        gps_accuracy_m = validated_data.get("gps_accuracy_m")
        if gps_location is None or gps_accuracy_m is None:
            raise ValidationError({"gps_location": ["GPS coordinates and accuracy are required for this check-in."]})
        pin = validated_data["location"]
        # PointField uses (x=lng, y=lat); geopy expects (lat, lng).
        pin_m = geodesic((pin.y, pin.x), (gps_location.y, gps_location.x)).meters
        allowance_m = max(unit.game.gps_drift_floor, gps_accuracy_m)
        if pin_m > allowance_m:
            raise ValidationError(
                {
                    "location": [
                        f"The pin is {int(pin_m)}m from your reported GPS position, beyond the {int(allowance_m)}m "
                        "tolerance. Move the pin closer to where you actually are."
                    ]
                }
            )

    def _verify_checkin_gap(self, unit: Unit) -> None:
        """Game-mode units require a minimum gap between consecutive check-ins.
        Anti-spam, and also keeps `_verify_implied_speed` well-conditioned —
        without this floor, a 200m pin correction five seconds later would
        imply ~150 km/h and trip the speed check."""
        if not unit.is_gps_enforced:
            return
        previous = unit.checkin_set.order_by("-date_created").first()
        if previous is None:
            return
        elapsed_s = (timezone.now() - previous.date_created).total_seconds()
        if elapsed_s < GAME_CHECKIN_MIN_GAP_SECONDS:
            raise ValidationError(
                {
                    "location": [
                        f"Please wait at least {GAME_CHECKIN_MIN_GAP_SECONDS} seconds "
                        "between check-ins on this lighter."
                    ]
                }
            )

    def _verify_implied_speed(self, unit: Unit, validated_data) -> None:
        """Reject game-mode check-ins that imply travel faster than is
        physically plausible since the previous check-in on this unit. Catches
        blatant location fakery (e.g. claimed in Berlin then Beijing minutes
        later). Scoped to game-mode because non-game units have no leaderboard
        to cheat on — the data-integrity payoff doesn't justify constraining
        a casual flow. The minimum-gap check above guarantees `elapsed > 0`."""
        if not unit.is_gps_enforced:
            return
        previous = unit.checkin_set.order_by("-date_created").first()
        if previous is None:
            return
        new_pin = validated_data["location"]
        prev_pin = previous.location
        elapsed_hours = (timezone.now() - previous.date_created).total_seconds() / 3600.0
        distance_km = geodesic((new_pin.y, new_pin.x), (prev_pin.y, prev_pin.x)).km
        if distance_km / elapsed_hours > CHECKIN_MAX_IMPLIED_SPEED_KMH:
            raise ValidationError({"location": ["That location seems a little... off?"]})

    def _verify_image_count(self, image_files) -> None:
        if len(image_files) > CHECKIN_MAX_IMAGES:
            raise serializers.ValidationError({"images": [f"You can upload at most {CHECKIN_MAX_IMAGES} images."]})

    def _save_checkin_record(self, unit, serializer):
        """Save the CheckIn after all pre-flight checks have passed."""
        if self.request.user.is_authenticated:
            checkin = serializer.save(created_by=self.request.user, unit=unit)
            unit.subscribers.add(self.request.user)
        else:
            checkin = serializer.save(created_by=None, unit=unit, edit_token=uuid.uuid4())
        return checkin

    def _attach_checkin_images(self, checkin, image_files):
        """Create CheckInImage rows; rolls back the checkin on any per-file failure.
        Count is enforced earlier in `_verify_image_count`, before the GPS token."""
        for i, f in enumerate(image_files):
            try:
                CheckInImage.objects.create(checkin=checkin, image=f, order=i)
            except Exception:  # noqa: BLE001
                checkin.delete()
                raise serializers.ValidationError(
                    {"images": [f"'{f.name}' could not be processed. Please upload a JPEG, PNG, or WebP file."]}
                ) from None

    def perform_create(self, serializer):
        unit = get_object_or_404(Unit.objects.select_related("game"), identifier=self.kwargs["identifier"])
        self._verify_game_required_fields(unit, serializer.validated_data)
        self._verify_can_check_in(unit)
        self._check_anon_captcha()
        self._verify_image_count(self.request.FILES.getlist("images"))
        self._verify_gps_drift(unit, serializer.validated_data)
        self._verify_checkin_gap(unit)
        self._verify_implied_speed(unit, serializer.validated_data)

        # Cache invalidation runs from the post_save signal in models.py.
        checkin = self._save_checkin_record(unit, serializer)
        self._attach_checkin_images(checkin, self.request.FILES.getlist("images"))

    def _update_checkin_images(self, checkin, request):
        raw = request.data.get("remove_image_ids", "[]")
        try:
            remove_ids = json.loads(raw) if isinstance(raw, str) else list(raw)
        except ValueError, TypeError:
            remove_ids = []
        if remove_ids:
            checkin.images.filter(id__in=remove_ids).delete()

        raw_order = request.data.get("image_ids_order", "[]")
        try:
            image_ids_order = json.loads(raw_order) if isinstance(raw_order, str) else list(raw_order)
        except ValueError, TypeError:
            image_ids_order = []
        for new_order, image_id in enumerate(image_ids_order):
            checkin.images.filter(id=image_id).update(order=new_order)

        image_files = request.FILES.getlist("images")
        remaining = checkin.images.count()
        if remaining + len(image_files) > CHECKIN_MAX_IMAGES:
            raise serializers.ValidationError({"images": [f"Cannot exceed {CHECKIN_MAX_IMAGES} images per check-in."]})
        next_order = remaining
        for i, f in enumerate(image_files):
            try:
                CheckInImage.objects.create(checkin=checkin, image=f, order=next_order + i)
            except Exception:  # noqa: BLE001
                raise serializers.ValidationError(
                    {"images": [f"'{f.name}' could not be processed. Please upload a JPEG, PNG, or WebP file."]}
                ) from None

    def _check_edit_token(self, checkin, grace_hours: int):
        if checkin.created_by_id is not None:
            msg = "This check-in has been claimed and can no longer be edited anonymously."
            raise PermissionDenied(msg)
        token = self.request.headers.get("X-Edit-Token")
        if not token or not checkin.edit_token or str(checkin.edit_token) != token:
            msg = "Invalid edit token."
            raise PermissionDenied(msg)
        if checkin.date_created < timezone.now() - timedelta(hours=grace_hours):
            msg = f"Cannot modify check-ins after {grace_hours} hours."
            raise PermissionDenied(msg)

    def partial_update(self, request, *args, **kwargs):
        if "location" in request.data:
            raise ValidationError({"location": ["Cannot be modified after creation."]})
        checkin = self.get_object()
        if not request.user.is_authenticated:
            self._check_edit_token(checkin, CHECKIN_EDIT_GRACE_PERIOD_HOURS)
        else:
            if checkin.created_by != request.user:
                msg = "You can only edit your own check-ins."
                raise PermissionDenied(msg)
            if checkin.date_created < timezone.now() - timedelta(hours=CHECKIN_EDIT_GRACE_PERIOD_HOURS):
                msg = f"Cannot edit check-ins after {CHECKIN_EDIT_GRACE_PERIOD_HOURS} hours."
                raise PermissionDenied(msg)

        super().partial_update(request, *args, **kwargs)
        self._update_checkin_images(checkin, request)

        checkin.refresh_from_db()
        serializer = self.get_serializer(checkin)
        return Response(serializer.data)

    def destroy(self, request, *args, **kwargs):
        checkin = self.get_object()
        if not request.user.is_authenticated:
            self._check_edit_token(checkin, CHECKIN_DELETE_GRACE_PERIOD_HOURS)
        else:
            if checkin.created_by != request.user:
                msg = "You can only delete your own check-ins."
                raise PermissionDenied(msg)
            if checkin.date_created < timezone.now() - timedelta(hours=CHECKIN_DELETE_GRACE_PERIOD_HOURS):
                msg = f"Cannot delete check-ins after {CHECKIN_DELETE_GRACE_PERIOD_HOURS} hours."
                raise PermissionDenied(msg)
        return super().destroy(request, *args, **kwargs)

    def perform_destroy(self, instance):
        # Cache invalidation runs from the post_delete signal in models.py.
        super().perform_destroy(instance)
