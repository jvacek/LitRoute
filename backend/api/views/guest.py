from allauth.core import ratelimit
from django.core import signing
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import validate_email
from django.shortcuts import get_object_or_404
from django.views import View
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from backend.models import CheckIn, Unit
from config.constants import GUEST_EMAIL_VERIFICATION_EXPIRY_SECONDS


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
