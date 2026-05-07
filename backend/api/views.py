import json
import logging
import urllib.parse
import urllib.request
import uuid
from datetime import timedelta

from allauth.core import ratelimit
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core import signing
from django.core.cache import cache
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import validate_email
from django.db.models import Count, OuterRef, Subquery
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.views import View
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers, status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.mixins import (
    CreateModelMixin,
    DestroyModelMixin,
    ListModelMixin,
    RetrieveModelMixin,
    UpdateModelMixin,
)
from rest_framework.parsers import JSONParser
from rest_framework.permissions import AllowAny, IsAuthenticatedOrReadOnly
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import GenericViewSet

from backend.models import CheckIn, CheckInImage, Game, Unit
from config.constants import (
    CHECKIN_DELETE_GRACE_PERIOD_HOURS,
    CHECKIN_EDIT_GRACE_PERIOD_HOURS,
    CHECKIN_MAX_IMAGES,
    GLOBE_PINS_CACHE_KEY,
    GLOBE_PINS_CACHE_TTL,
    GLOBE_PINS_COUNT,
    GUEST_EMAIL_VERIFICATION_EXPIRY_SECONDS,
    LOCATION_CLAIM_MAX_DRIFT_METERS,
    STATS_CACHE_KEY,
    STATS_CACHE_TTL,
)

from .serializers import CheckInSerializer, UnitSerializer

logger = logging.getLogger(__name__)


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
        from backend.services import total_distance_traveled_in_km  # noqa: PLC0415

        stats = cache.get(STATS_CACHE_KEY)
        if stats is None:
            stats = {
                "active_unit_count": Unit.objects.exclude(admin_only_checkin=True)
                .annotate(checkin_count=Count("checkin"))
                .exclude(checkin_count__lt=1)
                .count(),
                "checkin_count": CheckIn.objects.count(),
                "contributing_user_count": User.objects.annotate(checkin_count=Count("checkin"))
                .filter(checkin_count__gte=1)
                .count(),
                "total_distance_traveled_km": total_distance_traveled_in_km(),
            }
            cache.set(STATS_CACHE_KEY, stats, STATS_CACHE_TTL)
        return Response(stats)


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
        from django.contrib.gis.db.models.fields import PointField as GeoPointField  # noqa: PLC0415
        from django.db.models import OuterRef, Subquery  # noqa: PLC0415

        pins = cache.get(GLOBE_PINS_CACHE_KEY)
        if pins is None:
            latest_location_sq = (
                CheckIn.objects.filter(unit=OuterRef("pk")).order_by("-date_created").values("location")[:1]
            )
            latest_date_sq = (
                CheckIn.objects.filter(unit=OuterRef("pk")).order_by("-date_created").values("date_created")[:1]
            )
            locations = (
                Unit.objects.exclude(admin_only_checkin=True)
                .annotate(checkin_count=Count("checkin"))
                .exclude(checkin_count__lte=1)
                .annotate(latest_location=Subquery(latest_location_sq, output_field=GeoPointField()))
                .annotate(latest_date=Subquery(latest_date_sq))
                .exclude(latest_location__isnull=True)
                .order_by("-latest_date")
                .values_list("latest_location", flat=True)[:GLOBE_PINS_COUNT]
            )
            pins = [{"lat": loc.y, "lng": loc.x} for loc in locations if loc]
            cache.set(GLOBE_PINS_CACHE_KEY, pins, GLOBE_PINS_CACHE_TTL)
        return Response({"pins": pins})


class LocationClaimView(APIView):
    permission_classes = [AllowAny]
    parser_classes = [JSONParser]

    @extend_schema(
        request=inline_serializer(
            name="LocationClaimRequest",
            fields={
                "lat": serializers.FloatField(),
                "lng": serializers.FloatField(),
                "accuracy": serializers.FloatField(),
            },
        ),
        responses=inline_serializer(
            name="LocationClaimResponse",
            fields={"token": serializers.CharField()},
        ),
    )
    def post(self, request) -> Response:
        from backend.location_token import issue_location_claim  # noqa: PLC0415

        try:
            lat = float(request.data["lat"])
            lng = float(request.data["lng"])
            accuracy = float(request.data["accuracy"])
        except KeyError, TypeError, ValueError:
            return Response(
                {"detail": "lat, lng, and accuracy are required numeric fields."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        user_id = request.user.id if request.user.is_authenticated else None
        token = issue_location_claim(lat, lng, accuracy, user_id)
        return Response({"token": token})


class GameLeaderboardView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, pk: int):
        from backend.services import compute_game_leaderboard  # noqa: PLC0415

        game = get_object_or_404(Game, pk=pk)
        return Response(compute_game_leaderboard(game))


_game_unit_count_sq = (
    Unit.objects.filter(game_id=OuterRef("game_id")).values("game_id").annotate(c=Count("id")).values("c")
)


class UnitViewSet(RetrieveModelMixin, GenericViewSet):
    serializer_class = UnitSerializer
    lookup_field = "identifier"
    permission_classes = [IsAuthenticatedOrReadOnly]
    queryset = Unit.objects.select_related("game").annotate(
        checkin_count=Count("checkin", distinct=True),
        subscriber_count=Count("subscribers", distinct=True),
        game_total=Subquery(_game_unit_count_sq),
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

    def perform_create(self, serializer):  # noqa: C901, PLR0912, PLR0915
        from backend.location_token import verify_location_claim  # noqa: PLC0415
        from backend.services import game_leaderboard_cache_key, unit_distance_cache_key  # noqa: PLC0415

        unit = get_object_or_404(Unit, identifier=self.kwargs["identifier"])

        if unit.is_gps_location_enforced:
            token = self.request.data.get("location_token")
            if not token:
                raise ValidationError({"location_token": "Required for this unit."})
            point = serializer.validated_data.get("location")
            try:
                lat, lng = point.y, point.x
            except (AttributeError, TypeError) as exc:
                raise ValidationError({"location": "Invalid location format."}) from exc
            max_drift = unit.game.max_gps_drift if unit.game else LOCATION_CLAIM_MAX_DRIFT_METERS
            user_id = self.request.user.id if self.request.user.is_authenticated else None
            try:
                verify_location_claim(token, user_id, lat, lng, max_drift)
            except ValueError as exc:
                raise ValidationError({"location_token": str(exc)}) from exc

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
            checkin = serializer.save(created_by=self.request.user, unit=unit)
            unit.subscribers.add(self.request.user)
        else:
            if unit.admin_only_checkin:
                msg = "This unit can only be checked in by admins."
                raise PermissionDenied(msg)
            if settings.CLOUDFLARE_TURNSTILE_SECRET_KEY:
                turnstile_token = self.request.data.get("turnstile_token", "")
                if not _verify_turnstile(turnstile_token, self.request.META.get("REMOTE_ADDR", "")):
                    raise serializers.ValidationError({"captcha": ["Captcha verification failed. Please try again."]})
            else:
                logger.warning("CLOUDFLARE_TURNSTILE_SECRET_KEY is not set — anonymous check-in captcha is disabled")
            checkin = serializer.save(created_by=None, unit=unit, edit_token=uuid.uuid4())
        cache_keys = [unit_distance_cache_key(unit.identifier), STATS_CACHE_KEY, GLOBE_PINS_CACHE_KEY]
        if unit.game_id:
            cache_keys.append(game_leaderboard_cache_key(unit.game_id))
        cache.delete_many(cache_keys)

        image_files = self.request.FILES.getlist("images")
        if len(image_files) > CHECKIN_MAX_IMAGES:
            checkin.delete()
            raise serializers.ValidationError({"images": [f"You can upload at most {CHECKIN_MAX_IMAGES} images."]})
        for i, f in enumerate(image_files):
            try:
                CheckInImage.objects.create(checkin=checkin, image=f, order=i)
            except Exception:  # noqa: BLE001
                checkin.delete()
                raise serializers.ValidationError(
                    {"images": [f"'{f.name}' could not be processed. Please upload a JPEG, PNG, or WebP file."]}
                ) from None

    def _update_checkin_images(self, checkin, request):
        import json  # noqa: PLC0415

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

        unit = checkin.unit
        if unit.game_id:
            from backend.services import game_leaderboard_cache_key  # noqa: PLC0415

            cache.delete(game_leaderboard_cache_key(unit.game_id))

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
        from backend.services import game_leaderboard_cache_key, unit_distance_cache_key  # noqa: PLC0415

        unit = instance.unit
        unit_identifier = unit.identifier
        game_id = unit.game_id
        super().perform_destroy(instance)
        cache_keys = [unit_distance_cache_key(unit_identifier), STATS_CACHE_KEY, GLOBE_PINS_CACHE_KEY]
        if game_id:
            cache_keys.append(game_leaderboard_cache_key(game_id))
        cache.delete_many(cache_keys)


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
        from django.http import HttpResponseBadRequest, HttpResponseForbidden, HttpResponseRedirect  # noqa: PLC0415

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

        checkins = CheckIn.objects.filter(pk=checkin_id, unit=unit, created_by__isnull=True)
        if not user.name:
            checkin = checkins.first()
            if checkin and checkin.anonymous_name:
                user.name = checkin.anonymous_name
                user.save(update_fields=["name"])
        checkins.update(created_by=user, edit_token=None)

        cache_keys = [STATS_CACHE_KEY]
        if unit.game_id:
            from backend.services import game_leaderboard_cache_key  # noqa: PLC0415

            cache_keys.append(game_leaderboard_cache_key(unit.game_id))
        cache.delete_many(cache_keys)

        return HttpResponseRedirect(f"/unit/{unit_identifier}/?verified=1")
