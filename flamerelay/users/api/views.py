from allauth.account.adapter import get_adapter
from allauth.account.internal.flows.login_by_code import LoginCodeVerificationProcess
from allauth.account.models import EmailAddress
from allauth.account.utils import setup_user_email
from allauth.core import ratelimit
from allauth.socialaccount.models import SocialAccount
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import transaction
from django.db.models import Count
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import generics, serializers, status
from rest_framework.parsers import JSONParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from backend.api.serializers import UnitSerializer
from backend.api.views import turnstile
from flamerelay.users.models import User
from flamerelay.users.services import anonymize_user

from .serializers import UserSerializer


class AccountView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = UserSerializer
    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser]
    http_method_names = ["get", "patch", "delete", "head", "options"]

    def get_object(self):
        return self.request.user

    def perform_destroy(self, instance):
        anonymize_user(instance)


class AccountFollowsView(generics.ListAPIView):
    serializer_class = UnitSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return self.request.user.followed_units.annotate(
            checkin_count=Count("checkin", distinct=True),
            follower_count=Count("followers", distinct=True),
        )


class SocialAccountDisconnectView(APIView):
    """
    DELETE /api/account/social-accounts/ — remove a connected social account.

    Allauth's built-in disconnect rejects users with no usable password. Since
    this app is passwordless (magic code always works), we bypass that check and
    delete the SocialAccount directly. The user must have at least one verified
    email address so they can still receive sign-in codes after disconnect.
    """

    permission_classes = [IsAuthenticated]

    @extend_schema(
        request=inline_serializer(
            name="SocialAccountDisconnectRequest",
            fields={
                "provider": serializers.CharField(),
                "uid": serializers.CharField(),
            },
        ),
        responses={
            204: None,
            400: inline_serializer(name="SocialAccountError", fields={"detail": serializers.CharField()}),
            404: inline_serializer(name="SocialAccountNotFound", fields={"detail": serializers.CharField()}),
        },
    )
    def delete(self, request):
        provider = (request.data.get("provider") or "").strip()
        uid = (request.data.get("uid") or "").strip()
        if not provider or not uid:
            return Response(
                {"detail": "provider and uid are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        account = SocialAccount.objects.filter(user=request.user, provider=provider, uid=uid).first()
        if not account:
            return Response(
                {"detail": "Social account not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        if not EmailAddress.objects.filter(user=request.user).exists():
            return Response(
                {"detail": "Cannot disconnect: no email address on this account."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        account.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class RequestCodeView(APIView):
    """
    Unified sign-in / sign-up endpoint. Creates the account if it doesn't exist,
    then triggers allauth's login-by-code flow. Always returns the same response
    regardless of whether the email was registered, preventing email enumeration.
    Rate-limited via allauth's built-in ratelimit (ACCOUNT_RATE_LIMITS[request_login_code]).
    """

    permission_classes = [AllowAny]

    @extend_schema(
        request=inline_serializer(
            name="CodeRequest",
            fields={
                "email": serializers.EmailField(),
                "turnstile_token": serializers.CharField(required=False, allow_blank=True),
            },
        ),
        responses={
            200: inline_serializer(name="CodeRequestSuccess", fields={"detail": serializers.CharField()}),
            400: inline_serializer(name="CodeRequestError", fields={"detail": serializers.CharField()}),
            403: inline_serializer(name="CodeRequestForbidden", fields={"detail": serializers.CharField()}),
            429: inline_serializer(name="CodeRequestThrottled", fields={"detail": serializers.CharField()}),
        },
    )
    def post(self, request):
        if not get_adapter().is_open_for_signup(request):
            return Response(
                {"detail": "Signups are currently closed."},
                status=status.HTTP_403_FORBIDDEN,
            )

        email = (request.data.get("email") or "").strip().lower()

        if not email:
            return Response({"detail": "Email is required."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            validate_email(email)
        except ValidationError:
            return Response(
                {"detail": "Enter a valid email address."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Authed callers (reauthentication flow) already proved they're real.
        # Anonymous sign-in / sign-up must clear Turnstile before we spend
        # a rate-limit slot or send mail.
        if not request.user.is_authenticated and not turnstile.verify_request(request):
            return Response(
                {"detail": "Captcha verification failed. Please try again."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Use allauth's rate limit (default: 20/m/ip, 3/m/key)
        if not ratelimit.consume(request, action="request_login_code", key=email):
            return Response(
                {"detail": "Too many attempts. Please try again later."},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        user = self._get_or_create_user(request, email)

        LoginCodeVerificationProcess.initiate(
            request=request,
            user=user,
            email=email,
        )

        # Always return the same response — no info about whether the account existed
        return Response({"detail": "Code sent."}, status=status.HTTP_200_OK)

    @transaction.atomic
    def _get_or_create_user(self, request, email: str) -> User:
        try:
            return EmailAddress.objects.select_for_update().get(email__iexact=email).user
        except EmailAddress.DoesNotExist:
            pass

        # Users created outside allauth (e.g. createsuperuser) have User.email
        # but no EmailAddress row — backfill it so future logins use the fast path.
        try:
            user = User.objects.select_for_update().get(email__iexact=email)
            setup_user_email(request, user, [])
        except User.DoesNotExist:
            pass
        else:
            return user

        adapter = get_adapter()
        user = User(email=email)
        user.username = adapter.generate_unique_username([email])
        user.set_unusable_password()
        user.save()
        setup_user_email(request, user, [])
        return user
