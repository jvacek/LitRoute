"""Composition helpers for CheckInViewSet — keep the view focused on DRF
lifecycle wiring while validation, image management, and auth gates live
here as self-contained, independently testable units."""

import json
import secrets
import uuid
from datetime import timedelta

from django.utils import timezone
from geopy.distance import geodesic
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied, ValidationError

from backend.models import CheckInImage, Unit
from config.constants import (
    CHECKIN_IMAGE_MAX_UPLOAD_BYTES,
    CHECKIN_MAX_IMAGES,
    CHECKIN_MAX_IMPLIED_SPEED_KMH,
    CHECKIN_PENDING_UPLOAD_MAX_PER_SESSION,
    CHECKIN_PENDING_UPLOAD_TTL_HOURS,
    GAME_CHECKIN_MIN_GAP_SECONDS,
    MIN_GAME_REQUIRED_NAME_CHARS,
    MIN_GAME_REQUIRED_WORD_CHARS,
)

from . import _helpers
from ._helpers import _LETTER_OR_DIGIT_RE

# ── Pending-upload helpers ──────────────────────────────────────────────────


def _provision_session_key(request) -> str:
    """Return a stable session_key for the request, persisting the session
    if it doesn't have one yet. Safe to call from a view that is NOT wrapped
    by ATOMIC_REQUESTS — otherwise a later view-level rollback would wipe
    the just-inserted session row and SessionMiddleware would panic with
    SessionInterrupted on response. The pending-uploads view is marked
    `non_atomic_requests` for exactly this reason."""
    if not request.session.session_key:
        request.session.save()
    return request.session.session_key


# Sentinel used by `_identity_filter` when an anon caller has no session at
# all. The conditional UPDATE in `CheckinImageManager._claim_pending` filters
# on `session_key=...`, so a value that can't match any real key produces a
# clean "no rows updated → 400" instead of forcing a session-touch in a
# read-only code path.
_NO_SESSION_SENTINEL = "__no_session__"


def _identity_filter(request) -> dict:
    """Filter kwargs that scope a CheckInImage to the requester's identity.
    Authed users own by `uploaded_by`; anon users own by `session_key`.

    Strictly read-only: callers in ATOMIC_REQUESTS code paths (the attach
    flow on /checkins/) must not allocate a new session here, or a later
    rollback would corrupt it. If an anon caller has no session yet, no
    pending rows can match, so we return a sentinel that the conditional
    UPDATE rejects with zero affected rows.
    """
    if request.user.is_authenticated:
        return {"uploaded_by": request.user}
    return {"session_key": request.session.session_key or _NO_SESSION_SENTINEL}


def _verify_pending_upload_captcha(request) -> None:
    """Anon-only Turnstile gate, cached for the lifetime of the Django
    session. First pending-upload of an anon session must include a
    `turnstile_token`; subsequent uploads in the same session skip the
    check. Authed users skip entirely."""
    if request.user.is_authenticated:
        return
    if request.session.get("pending_uploads_verified"):
        return
    turnstile_token = request.data.get("turnstile_token", "")
    remote_ip = request.headers.get("cf-connecting-ip") or request.META.get("REMOTE_ADDR", "")
    if not _helpers._verify_turnstile(turnstile_token, remote_ip):  # noqa: SLF001
        raise serializers.ValidationError({"captcha": ["Captcha verification failed. Please try again."]})
    request.session["pending_uploads_verified"] = True


def create_pending_upload(unit: Unit, request) -> CheckInImage:
    """Validate + persist a single pending upload for `unit`.

    Returns the saved CheckInImage row (checkin=None, attach_token set).
    The view turns this into a JSON `{ token, preview_url }`.

    All checks raise DRF ValidationError or PermissionDenied so the view
    layer doesn't need any try/except wiring.
    """
    # Block admin-only units up front. We *don't* run the full game-mode
    # can_user_check_in() check here — the submit endpoint runs the
    # authoritative pipeline. Letting an upload through that can't be
    # attached later is mildly annoying, but pre-fetching `previous` on
    # every upload would add a SELECT per photo for an unreliable outcome.
    user = request.user
    is_admin = user.is_authenticated and (user.is_superuser or user.is_staff)
    if unit.admin_only_checkin and not is_admin:
        msg = "This unit can only be checked in by admins."
        raise PermissionDenied(msg)

    _verify_pending_upload_captcha(request)

    # Anon callers need a stable session_key so the attach step (which runs
    # inside ATOMIC_REQUESTS and won't touch the session) can match this
    # row by identity. Provisioning here is safe because the view is
    # decorated `non_atomic_requests`.
    if not user.is_authenticated:
        _provision_session_key(request)

    identity = _identity_filter(request)
    outstanding = CheckInImage.objects.filter(checkin__isnull=True, **identity).count()
    if outstanding >= CHECKIN_PENDING_UPLOAD_MAX_PER_SESSION:
        # Mirrors the language of CHECKIN_MAX_IMAGES so the frontend can
        # surface a coherent message for both caps.
        raise serializers.ValidationError(
            {
                "image": [
                    f"You have {outstanding} photos waiting to be attached to a check-in. "
                    "Finish that check-in or wait for the cleanup sweep before uploading more."
                ]
            }
        )

    image_file = request.FILES.get("image")
    if image_file is None:
        raise serializers.ValidationError({"image": ["This field is required."]})
    # Mirror the model-level validate_image_size check. Field validators only
    # run on `full_clean()`; doing it here lets us reject oversized payloads
    # cleanly before ResizedImageField hands the bytes to Pillow (which would
    # otherwise blow up with UnidentifiedImageError on non-image bytes).
    if image_file.size > CHECKIN_IMAGE_MAX_UPLOAD_BYTES:
        mb = CHECKIN_IMAGE_MAX_UPLOAD_BYTES // (1024 * 1024)
        raise serializers.ValidationError({"image": [f"Image file too large. Maximum size is {mb} MB."]})

    return CheckInImage.objects.create(
        checkin=None,
        image=image_file,
        attach_token=secrets.token_urlsafe(32),
        uploaded_by=user if user.is_authenticated else None,
        session_key="" if user.is_authenticated else request.session.session_key,
    )


class CheckinValidator:
    """All pre-flight checks for creating a check-in. Built once per request;
    the caller pre-fetches `previous` so the gap, speed, and ownership
    checks share a single SELECT."""

    def __init__(self, unit: Unit, request, previous):
        self.unit = unit
        self.request = request
        self.previous = previous

    def run_create_checks(self, validated_data, pending_image_tokens) -> None:
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
        self.verify_image_count(pending_image_tokens)
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
        """Anon-only Turnstile check. Skipped if the session already passed
        Turnstile during a pending-image upload — one solve per session
        covers the whole upload+submit flow."""
        if self.request.user.is_authenticated:
            return
        if self.request.session.get("pending_uploads_verified"):
            return
        turnstile_token = self.request.data.get("turnstile_token", "")
        remote_ip = self.request.headers.get("cf-connecting-ip") or self.request.META.get("REMOTE_ADDR", "")
        # Look up via the module so test patches of
        # `backend.api.views._helpers._verify_turnstile` take effect.
        if not _helpers._verify_turnstile(turnstile_token, remote_ip):  # noqa: SLF001
            raise serializers.ValidationError({"captcha": ["Captcha verification failed. Please try again."]})

    def verify_image_count(self, pending_image_tokens) -> None:
        if len(pending_image_tokens) > CHECKIN_MAX_IMAGES:
            raise serializers.ValidationError(
                {"pending_image_tokens": [f"You can attach at most {CHECKIN_MAX_IMAGES} images."]}
            )

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

    def attach(self, tokens: list[str]) -> None:
        """Claim the pending CheckInImage rows for `tokens` and bind them to
        this check-in. Order on the check-in matches the order of the
        passed-in list. Race-safe against the cleanup sweep and against
        double-submits via a conditional UPDATE that asserts the affected
        row count."""
        self._claim_pending(tokens, start_order=0)

    def update(self, tokens: list[str]) -> None:
        """Process a PATCH: remove existing images by id, then reorder by id,
        then attach newly-uploaded pending rows by token at the tail.
        Enforces total count."""
        remove_ids = self._parse_id_list("remove_image_ids")
        if remove_ids:
            self.checkin.images.filter(id__in=remove_ids).delete()

        self._reorder(self._parse_id_list("image_ids_order"))

        if not tokens:
            return
        remaining = self.checkin.images.count()
        if remaining + len(tokens) > CHECKIN_MAX_IMAGES:
            raise serializers.ValidationError(
                {"pending_image_tokens": [f"Cannot exceed {CHECKIN_MAX_IMAGES} images per check-in."]}
            )
        self._claim_pending(tokens, start_order=remaining)

    def _claim_pending(self, tokens: list[str], *, start_order: int) -> None:
        """Atomic claim of pending CheckInImage rows for this checkin.

        The WHERE clause on the UPDATE is the safety net: only rows that are
        still pending, still within TTL, and owned by the requester's
        identity get bound. If the affected count doesn't match the input
        list, *none* of the rows count as attached — we raise and the
        request rolls back via ATOMIC_REQUESTS.
        """
        if not tokens:
            return
        cutoff = timezone.now() - timedelta(hours=CHECKIN_PENDING_UPLOAD_TTL_HOURS)
        identity = _identity_filter(self.request)
        n = CheckInImage.objects.filter(
            attach_token__in=tokens,
            checkin__isnull=True,
            uploaded_at__gte=cutoff,
            **identity,
        ).update(checkin=self.checkin)
        if n != len(tokens):
            raise serializers.ValidationError(
                {
                    "pending_image_tokens": [
                        "One or more uploaded photos could not be attached. "
                        "They may have expired or already been used — please re-upload."
                    ]
                }
            )
        # Second pass: assign the client-supplied order and clear the
        # pending-only fields. Race-safe because the UPDATE above already
        # bound the rows; nothing else can flip them back to pending.
        rows = {r.attach_token: r for r in CheckInImage.objects.filter(checkin=self.checkin, attach_token__in=tokens)}
        to_update = []
        for i, token in enumerate(tokens):
            row = rows[token]
            row.order = start_order + i
            row.attach_token = None
            row.session_key = ""
            row.uploaded_by = None
            to_update.append(row)
        CheckInImage.objects.bulk_update(to_update, ["order", "attach_token", "session_key", "uploaded_by"])

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
