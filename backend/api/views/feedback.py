from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import validate_email
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from backend.models import Feedback
from config.constants import FEEDBACK_MESSAGE_MAX_LENGTH

from . import turnstile


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
            if not turnstile.verify_turnstile(turnstile_token, remote_ip):
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
