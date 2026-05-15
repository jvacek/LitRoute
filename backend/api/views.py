import json
import logging
import re
import urllib.parse
import urllib.request
import uuid
from datetime import timedelta

from allauth.core import ratelimit
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core import signing
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import validate_email
from django.db.models import Count
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.views import View
from drf_spectacular.utils import OpenApiParameter, extend_schema, inline_serializer
from geopy.distance import geodesic
from rest_framework import serializers, status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.mixins import (
    CreateModelMixin,
    DestroyModelMixin,
    ListModelMixin,
    RetrieveModelMixin,
    UpdateModelMixin,
)
from rest_framework.permissions import AllowAny, IsAuthenticatedOrReadOnly
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import GenericViewSet

from backend.models import CheckIn, CheckInImage, Feedback, Game, Unit
from config.constants import (
    CHECKIN_DELETE_GRACE_PERIOD_HOURS,
    CHECKIN_EDIT_GRACE_PERIOD_HOURS,
    CHECKIN_MAX_IMAGES,
    CHECKIN_MAX_IMPLIED_SPEED_KMH,
    FEEDBACK_MESSAGE_MAX_LENGTH,
    GAME_CHECKIN_MIN_GAP_SECONDS,
    GUEST_EMAIL_VERIFICATION_EXPIRY_SECONDS,
    MIN_GAME_REQUIRED_WORD_CHARS,
)

from .serializers import (
    CheckInSerializer,
    GameJourneysSerializer,
    LeaderboardSerializer,
    UnitSerializer,
)

logger = logging.getLogger(__name__)

# Unicode letters or digits, mirroring the frontend's /[\p{L}\p{N}]/gu.
# `[^\W_]` = word character that isn't underscore = letter or digit.
_LETTER_OR_DIGIT_RE = re.compile(r"[^\W_]")


def _verify_turnstile(token: str, remote_ip: str = "") -> bool:
    try:
        payload = urllib.parse.urlencode(
            {
                "secret": settings.CLOUDFLARE_TURNSTILE_SECRET_KEY,
                "response": token,
                "remoteip": remote_ip,
            }
        ).encode()
        req = urllib.request.Request(
            "https://challenges.cloudflare.com/turnstile/v0/siteverify",
            data=payload,
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=5) as resp:  # noqa: S310
            return json.loads(resp.read()).get("success", False)
    except Exception:
        logger.exception("Turnstile verification error")
        return False


User = get_user_model()


class ConfigView(APIView):
    permission_classes = [AllowAny]

    @extend_schema(
        responses=inline_serializer(
            name="Config",
            fields={
                "maptilerKey": serializers.CharField(),
                "allowRegistration": serializers.BooleanField(),
                "turnstileSiteKey": serializers.CharField(),
            },
        )
    )
    def get(self, request) -> Response:
        return Response(
            {
                "maptilerKey": settings.MAPTILER_KEY,
                "allowRegistration": settings.ACCOUNT_ALLOW_REGISTRATION,
                "turnstileSiteKey": settings.CLOUDFLARE_TURNSTILE_SITE_KEY,
            }
        )


class StatsView(APIView):
    permission_classes = [AllowAny]

    @extend_schema(
        responses=inline_serializer(
            name="Stats",
            fields={
                "active_unit_count": serializers.IntegerField(),
                "checkin_count": serializers.IntegerField(),
                "contributing_user_count": serializers.IntegerField(),
                "total_distance_traveled_km": serializers.FloatField(),
            },
        )
    )
    def get(self, request) -> Response:
        from backend.services import get_cached_stats  # noqa: PLC0415

        return Response(get_cached_stats())


class GlobePinsView(APIView):
    permission_classes = [AllowAny]

    @extend_schema(
        responses=inline_serializer(
            name="GlobePins",
            fields={
                "pins": serializers.ListField(
                    child=inline_serializer(
                        name="GlobePin",
                        fields={
                            "lat": serializers.FloatField(),
                            "lng": serializers.FloatField(),
                        },
                    )
                )
            },
        )
    )
    def get(self, request) -> Response:
        from backend.services import get_cached_globe_pins  # noqa: PLC0415

        return Response({"pins": get_cached_globe_pins()})


class GameLeaderboardView(APIView):
    permission_classes = [AllowAny]

    @extend_schema(
        parameters=[
            OpenApiParameter("pk", int, OpenApiParameter.PATH),
            OpenApiParameter(
                "from",
                str,
                OpenApiParameter.QUERY,
                required=False,
                description=(
                    "Unit identifier whose row should keep its identifier in the "
                    "response. All other rows return identifier=null so the "
                    "public endpoint cannot be used to enumerate unit slugs."
                ),
            ),
        ],
        responses=LeaderboardSerializer,
    )
    def get(self, request, pk: int):
        from backend.services import compute_game_leaderboard  # noqa: PLC0415

        game = get_object_or_404(Game, pk=pk)
        data = compute_game_leaderboard(game)
        from_identifier = request.query_params.get("from")
        # Build a new individual list at the response boundary; the cached dict
        # keeps full identifiers server-side. Mutating the cache would pollute
        # subsequent callers.
        return Response(
            {
                **data,
                "individual": [
                    {**row, "identifier": row["identifier"] if row["identifier"] == from_identifier else None}
                    for row in data["individual"]
                ],
            }
        )


class GameJourneysView(APIView):
    """Map data for a Game's journeys, split from the leaderboard endpoint so
    table-only callers (rank lookups on the unit page, the leaderboard table
    itself) don't pay for the coordinate dump on every fetch. Anonymous: no
    identifiers in the payload."""

    permission_classes = [AllowAny]

    @extend_schema(
        parameters=[OpenApiParameter("pk", int, OpenApiParameter.PATH)],
        responses=GameJourneysSerializer,
    )
    def get(self, request, pk: int):
        from backend.services import compute_game_journeys  # noqa: PLC0415

        game = get_object_or_404(Game, pk=pk)
        return Response(compute_game_journeys(game))


class UnitViewSet(RetrieveModelMixin, GenericViewSet):
    serializer_class = UnitSerializer
    lookup_field = "identifier"
    permission_classes = [IsAuthenticatedOrReadOnly]

    def get_queryset(self):
        return Unit.objects.select_related("game").annotate(
            checkin_count=Count("checkin", distinct=True),
            subscriber_count=Count("subscribers", distinct=True),
        )

    def get_permissions(self):
        # subscribe/unsubscribe handle auth manually to return 401 (not 403).
        # IsAuthenticatedOrReadOnly would return 403 when SessionAuthentication
        # is the primary authenticator because it has no authenticate_header().
        if self.action in ("subscribe", "unsubscribe"):
            return [AllowAny()]
        return super().get_permissions()

    @extend_schema(request=None, responses={204: None, 401: None}, auth=[{"cookieAuth": []}])
    def subscribe(self, request, identifier=None):
        if not request.user.is_authenticated:
            return Response(status=status.HTTP_401_UNAUTHORIZED)
        unit = get_object_or_404(Unit, identifier=identifier)
        unit.subscribers.add(request.user)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @extend_schema(request=None, responses={204: None, 401: None}, auth=[{"cookieAuth": []}])
    def unsubscribe(self, request, identifier=None):
        if not request.user.is_authenticated:
            return Response(status=status.HTTP_401_UNAUTHORIZED)
        unit = get_object_or_404(Unit, identifier=identifier)
        unit.subscribers.remove(request.user)
        return Response(status=status.HTTP_204_NO_CONTENT)


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
            if len(_LETTER_OR_DIGIT_RE.findall(anon_name)) < MIN_GAME_REQUIRED_WORD_CHARS:
                errors["anonymous_name"] = [
                    f"Name is required ({MIN_GAME_REQUIRED_WORD_CHARS}+ letters or digits) "
                    "so this check-in can be attributed on the leaderboard.",
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
        if not _verify_turnstile(turnstile_token, remote_ip):
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


class GuestSubscribeView(APIView):
    permission_classes = [AllowAny]

    @extend_schema(
        request=inline_serializer(
            name="GuestSubscribeRequest",
            fields={
                "email": serializers.EmailField(),
                "checkin_id": serializers.IntegerField(),
            },
        ),
        responses={
            201: inline_serializer(name="GuestSubscribeSuccess", fields={"detail": serializers.CharField()}),
            400: inline_serializer(name="GuestSubscribeError", fields={"detail": serializers.CharField()}),
        },
    )
    def post(self, request, identifier):
        from rest_framework.authentication import SessionAuthentication  # noqa: PLC0415

        from backend.services import send_guest_verification_email_task  # noqa: PLC0415

        SessionAuthentication().enforce_csrf(request)

        email = (request.data.get("email") or "").strip().lower()
        checkin_id = request.data.get("checkin_id")

        if not email:
            return Response({"detail": "Email is required."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            validate_email(email)
        except DjangoValidationError:
            return Response({"detail": "Enter a valid email address."}, status=status.HTTP_400_BAD_REQUEST)
        if not checkin_id:
            return Response({"detail": "checkin_id is required."}, status=status.HTTP_400_BAD_REQUEST)

        if not ratelimit.consume(request, action="guest_subscribe", key=email):
            return Response(
                {"detail": "Too many attempts. Please try again later."},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        unit = get_object_or_404(Unit, identifier=identifier)
        checkin = get_object_or_404(CheckIn, pk=checkin_id, unit=unit, created_by__isnull=True)

        token = signing.dumps(
            {"email": email, "unit": identifier, "checkin_id": checkin.pk},
            salt="guest-verify",
        )
        base_url = request.build_absolute_uri("/").rstrip("/")
        send_guest_verification_email_task.delay(token, email, identifier, base_url)
        return Response({"detail": "Verification email sent."}, status=status.HTTP_201_CREATED)


class GuestVerifyView(View):
    def get(self, request):
        from allauth.account.models import EmailAddress  # noqa: PLC0415
        from allauth.account.utils import perform_login  # noqa: PLC0415
        from django.http import HttpResponseBadRequest, HttpResponseForbidden  # noqa: PLC0415

        if not ratelimit.consume(request, action="guest_verify"):
            return HttpResponseForbidden("Too many attempts. Please try again later.")

        from flamerelay.users.api.views import RequestCodeView  # noqa: PLC0415

        token = request.GET.get("token", "")
        try:
            data = signing.loads(token, salt="guest-verify", max_age=GUEST_EMAIL_VERIFICATION_EXPIRY_SECONDS)
        except signing.SignatureExpired:
            return HttpResponseBadRequest("This verification link has expired.")
        except signing.BadSignature:
            return HttpResponseBadRequest("Invalid verification link.")

        email = data["email"]
        unit_identifier = data["unit"]
        checkin_id = data["checkin_id"]

        user = RequestCodeView()._get_or_create_user(request, email)  # noqa: SLF001

        EmailAddress.objects.update_or_create(
            user=user,
            email=email,
            defaults={"verified": True, "primary": True},
        )

        unit = get_object_or_404(Unit, identifier=unit_identifier)
        unit.subscribers.add(user)

        # explicit list for cache snapshot
        checkins = list(CheckIn.objects.filter(pk=checkin_id, unit=unit, created_by__isnull=True))

        if not user.name:
            for c in checkins:
                if c.anonymous_name:
                    user.name = c.anonymous_name
                    user.save(update_fields=["name"])
                    break
        # Per-instance save (not queryset.update) so the post_save signal
        # fires and the cache invalidation in models.py runs. Stats also
        # needs to invalidate (contributing_user_count changes when a guest
        # claim flips created_by from null to a user); the signal handles
        # that via invalidate_checkin_caches.
        for c in checkins:
            c.created_by = user
            c.edit_token = None
            c.save(update_fields=["created_by", "edit_token"])

        # Establish a Django session so the user lands on the unit page already
        # signed in. Without this, the check-in is claimed in the DB but the
        # browser is still anonymous — so neither isAnonOwned nor the auth
        # owner branch matches and the visitor loses access to the check-in.
        return perform_login(
            request,
            user,
            email=email,
            redirect_url=f"/unit/{unit_identifier}/?verified=1",
        )


class FeedbackView(APIView):
    permission_classes = [AllowAny]

    @extend_schema(
        request=inline_serializer(
            name="FeedbackRequest",
            fields={
                "message": serializers.CharField(max_length=FEEDBACK_MESSAGE_MAX_LENGTH),
                "email": serializers.EmailField(required=False, allow_blank=True),
                "turnstile_token": serializers.CharField(required=False, allow_blank=True),
            },
        ),
        responses={
            201: inline_serializer(name="FeedbackSuccess", fields={"detail": serializers.CharField()}),
            400: inline_serializer(name="FeedbackError", fields={"detail": serializers.CharField()}),
        },
    )
    def post(self, request):
        message = (request.data.get("message") or "").strip()
        if not message:
            return Response({"detail": "Message is required."}, status=status.HTTP_400_BAD_REQUEST)
        if len(message) > FEEDBACK_MESSAGE_MAX_LENGTH:
            return Response(
                {"detail": f"Message must be {FEEDBACK_MESSAGE_MAX_LENGTH} characters or fewer."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if request.user.is_authenticated:
            email = request.user.email or ""
            user = request.user
        else:
            turnstile_token = request.data.get("turnstile_token", "")
            remote_ip = request.headers.get("cf-connecting-ip") or request.META.get("REMOTE_ADDR", "")
            if not _verify_turnstile(turnstile_token, remote_ip):
                return Response(
                    {"detail": "Captcha verification failed. Please try again."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            email = (request.data.get("email") or "").strip().lower()
            if email:
                try:
                    validate_email(email)
                except DjangoValidationError:
                    return Response(
                        {"detail": "Enter a valid email address."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
            user = None

        Feedback.objects.create(user=user, email=email, message=message)
        return Response({"detail": "Feedback received."}, status=status.HTTP_201_CREATED)
