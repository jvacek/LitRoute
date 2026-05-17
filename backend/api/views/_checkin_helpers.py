"""Composition helpers for CheckInViewSet — keep the view focused on DRF
lifecycle wiring while validation, image management, and auth gates live
here as self-contained, independently testable units."""

import json
import uuid
from datetime import timedelta

from django.utils import timezone
from geopy.distance import geodesic
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied, ValidationError

from backend.models import CheckInImage, Unit
from config.constants import (
    CHECKIN_MAX_IMAGES,
    CHECKIN_MAX_IMPLIED_SPEED_KMH,
    GAME_CHECKIN_MIN_GAP_SECONDS,
    MIN_GAME_REQUIRED_NAME_CHARS,
    MIN_GAME_REQUIRED_WORD_CHARS,
)

from . import _helpers
from ._helpers import _LETTER_OR_DIGIT_RE


class CheckinValidator:
    """All pre-flight checks for creating a check-in. Built once per request;
    the caller pre-fetches `previous` so the gap, speed, and ownership
    checks share a single SELECT."""

    def __init__(self, unit: Unit, request, previous):
        self.unit = unit
        self.request = request
        self.previous = previous

    def run_create_checks(self, validated_data, image_files) -> None:
        """Order matters:
        - game-required-fields surfaces bad payloads early (cheap field check).
        - can-check-in returns 403 before we burn a Turnstile token on a request
          that was always going to be rejected.
        - captcha runs before GPS/previous-checkin so anon callers don't waste
          time on checks they'd never pass anyway.
        - image_count is cheap; runs before drift/previous since those touch
          the database via the `previous` row and `unit.game`.
        """
        self.verify_game_required_fields(validated_data)
        self.verify_can_check_in()
        self.check_anon_captcha()
        self.verify_image_count(image_files)
        self.verify_gps_drift(validated_data)
        self.verify_previous_checkin_constraints(validated_data)

    def verify_game_required_fields(self, validated_data) -> None:
        """For game-enforced units, require a real `place` (everyone) and a real
        `anonymous_name` (anon only) so leaderboard rows can be attributed.
        Mirrors the frontend's MIN_REQUIRED_WORD_CHARS check — savvy clients
        could otherwise bypass it via curl."""
        if not self.unit.is_gps_enforced:
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

    def verify_can_check_in(self) -> None:
        """Permission gate. Runs before any single-use token is consumed so a 403
        doesn't force the user to recapture GPS."""
        user = self.request.user
        is_admin = user.is_authenticated and (user.is_superuser or user.is_staff)
        if self.unit.admin_only_checkin and not is_admin:
            msg = "This unit can only be checked in by admins."
            raise PermissionDenied(msg)
        if user.is_authenticated and not self.unit.can_user_check_in(user, previous=self.previous):
            msg = (
                "You can't check in here — once someone else takes the lighter, "
                "its journey moves on. You can still follow along."
            )
            raise PermissionDenied(msg)

    def check_anon_captcha(self) -> None:
        """Anon-only Turnstile check."""
        if self.request.user.is_authenticated:
            return
        turnstile_token = self.request.data.get("turnstile_token", "")
        remote_ip = self.request.headers.get("cf-connecting-ip") or self.request.META.get("REMOTE_ADDR", "")
        # Look up via the module so test patches of
        # `backend.api.views._helpers._verify_turnstile` take effect.
        if not _helpers._verify_turnstile(turnstile_token, remote_ip):  # noqa: SLF001
            raise serializers.ValidationError({"captcha": ["Captcha verification failed. Please try again."]})

    def verify_image_count(self, image_files) -> None:
        if len(image_files) > CHECKIN_MAX_IMAGES:
            raise serializers.ValidationError({"images": [f"You can upload at most {CHECKIN_MAX_IMAGES} images."]})

    def verify_gps_drift(self, validated_data) -> None:
        """Game-mode units must submit a device-reported GPS coordinate plus
        an accuracy radius. We accept the pin if it sits inside either the
        game's configured drift envelope OR the user's own reported accuracy
        circle — whichever is larger. The accuracy fallback means honest users
        with coarse Wi-Fi/cell fixes can still drop the pin where they
        actually are, while clean fixes stay tightly bounded."""
        if not self.unit.is_gps_enforced:
            return
        gps_location = validated_data.get("gps_location")
        gps_accuracy_m = validated_data.get("gps_accuracy_m")
        if gps_location is None or gps_accuracy_m is None:
            raise ValidationError({"gps_location": ["GPS coordinates and accuracy are required for this check-in."]})
        pin = validated_data["location"]
        # PointField uses (x=lng, y=lat); geopy expects (lat, lng).
        pin_m = geodesic((pin.y, pin.x), (gps_location.y, gps_location.x)).meters
        allowance_m = max(self.unit.game.gps_drift_floor, gps_accuracy_m)
        if pin_m > allowance_m:
            raise ValidationError(
                {
                    "location": [
                        f"The pin is {int(pin_m)}m from your reported GPS position, beyond the {int(allowance_m)}m "
                        "tolerance. Move the pin closer to where you actually are."
                    ]
                }
            )

    def verify_previous_checkin_constraints(self, validated_data) -> None:
        """Game-mode constraints that depend on the previous check-in:
        1. Minimum gap between consecutive check-ins (anti-spam, and keeps
           the speed check well-conditioned — without this floor a 200m pin
           correction five seconds later would imply ~150 km/h).
        2. Implied-speed cap — rejects blatant location fakery (Berlin then
           Beijing minutes later). Scoped to game-mode because non-game
           units have no leaderboard to cheat on. The gap check above
           guarantees `elapsed > 0` for the speed division."""
        if not self.unit.is_gps_enforced or self.previous is None:
            return
        elapsed_s = (timezone.now() - self.previous.date_created).total_seconds()
        if elapsed_s < GAME_CHECKIN_MIN_GAP_SECONDS:
            raise ValidationError(
                {
                    "location": [
                        f"Please wait at least {GAME_CHECKIN_MIN_GAP_SECONDS} seconds "
                        "between check-ins on this lighter."
                    ]
                }
            )
        new_pin = validated_data["location"]
        prev_pin = self.previous.location
        distance_km = geodesic((new_pin.y, new_pin.x), (prev_pin.y, prev_pin.x)).km
        if distance_km / (elapsed_s / 3600.0) > CHECKIN_MAX_IMPLIED_SPEED_KMH:
            raise ValidationError({"location": ["That location seems a little... off?"]})


class CheckinImageManager:
    """Owns CheckInImage create/update/reorder for one check-in."""

    def __init__(self, checkin, request):
        self.checkin = checkin
        self.request = request

    def attach(self) -> None:
        """Create CheckInImage rows on initial check-in creation; rolls back
        the parent check-in on any per-file failure. Count is enforced
        earlier in `CheckinValidator._verify_image_count`, before the GPS
        token is consumed."""
        image_files = self.request.FILES.getlist("images")
        for i, f in enumerate(image_files):
            try:
                self._create(f, i)
            except serializers.ValidationError:
                self.checkin.delete()
                raise

    def update(self) -> None:
        """Process a PATCH: remove existing images by id, then reorder by id,
        then append new uploads at the tail. Enforces total count."""
        remove_ids = self._parse_id_list("remove_image_ids")
        if remove_ids:
            self.checkin.images.filter(id__in=remove_ids).delete()

        self._reorder(self._parse_id_list("image_ids_order"))

        image_files = self.request.FILES.getlist("images")
        remaining = self.checkin.images.count()
        if remaining + len(image_files) > CHECKIN_MAX_IMAGES:
            raise serializers.ValidationError({"images": [f"Cannot exceed {CHECKIN_MAX_IMAGES} images per check-in."]})
        for i, f in enumerate(image_files):
            self._create(f, remaining + i)

    def _parse_id_list(self, field: str) -> list:
        """Tolerantly parse a JSON-encoded id list from form/JSON payloads.
        Returns [] on any parse error — clients send these as best-effort hints."""
        raw = self.request.data.get(field, "[]")
        try:
            return json.loads(raw) if isinstance(raw, str) else list(raw)
        except ValueError, TypeError:
            return []

    def _reorder(self, image_ids_order: list) -> None:
        if not image_ids_order:
            return
        images_by_id = {img.id: img for img in self.checkin.images.filter(id__in=image_ids_order)}
        to_update = []
        for new_order, image_id in enumerate(image_ids_order):
            img = images_by_id.get(image_id)
            if img is not None:
                img.order = new_order
                to_update.append(img)
        if to_update:
            CheckInImage.objects.bulk_update(to_update, ["order"])

    def _create(self, f, order: int) -> None:
        """Translate storage failures into a user-facing validation error
        that names the offending file."""
        try:
            CheckInImage.objects.create(checkin=self.checkin, image=f, order=order)
        except Exception:  # noqa: BLE001
            raise serializers.ValidationError(
                {"images": [f"'{f.name}' could not be processed. Please upload a JPEG, PNG, or WebP file."]}
            ) from None


def check_edit_token(checkin, request, grace_hours: int) -> None:
    if checkin.created_by_id is not None:
        msg = "This check-in has been claimed and can no longer be edited anonymously."
        raise PermissionDenied(msg)
    token = request.headers.get("X-Edit-Token")
    if not token or not checkin.edit_token or str(checkin.edit_token) != token:
        msg = "Invalid edit token."
        raise PermissionDenied(msg)
    if checkin.date_created < timezone.now() - timedelta(hours=grace_hours):
        msg = f"Cannot modify check-ins after {grace_hours} hours."
        raise PermissionDenied(msg)


def check_authenticated_owner(checkin, user, verb: str, grace_hours: int) -> None:
    if checkin.created_by != user:
        msg = f"You can only {verb} your own check-ins."
        raise PermissionDenied(msg)
    if checkin.date_created < timezone.now() - timedelta(hours=grace_hours):
        msg = f"Cannot {verb} check-ins after {grace_hours} hours."
        raise PermissionDenied(msg)


def save_checkin_record(unit, serializer, user):
    """Save the CheckIn after all pre-flight checks have passed. Authenticated
    callers auto-follow the unit; anon callers get a one-shot edit token."""
    if user.is_authenticated:
        checkin = serializer.save(created_by=user, unit=unit)
        unit.followers.add(user)
    else:
        checkin = serializer.save(created_by=None, unit=unit, edit_token=uuid.uuid4())
    return checkin
