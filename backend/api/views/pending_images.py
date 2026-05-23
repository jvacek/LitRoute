"""Standalone upload endpoint for one CheckInImage at a time.

Split out from CheckInViewSet because this is the one action in the
check-in surface that MUST NOT be wrapped by ATOMIC_REQUESTS:

  - Anon callers need a Django session row persisted on their first
    upload so the captcha-verification cache (`pending_uploads_verified`)
    can be read by subsequent uploads and by the eventual check-in
    submit. If a per-request transaction rolled back (e.g., because the
    user picked an oversized file as their second photo), the session
    row would be wiped and SessionMiddleware would raise
    `SessionInterrupted` on the response.
  - The view writes exactly one CheckInImage row, so request-level
    atomicity isn't needed anyway.

`@method_decorator(transaction.non_atomic_requests, name="dispatch")`
has to live on the class — Django's `BaseHandler.make_view_atomic`
reads `_non_atomic_requests` off the view callable returned by
`as_view()`, not off the dispatched method. A decorator on a viewset
action method is silently ignored, which is why this can't ride along
inside `CheckInViewSet`.
"""

from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils.decorators import method_decorator
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from backend.models import Unit

from ._checkin_helpers import create_pending_upload


@method_decorator(transaction.non_atomic_requests, name="dispatch")
class PendingImageUploadView(APIView):
    permission_classes = [AllowAny]

    @extend_schema(
        request=inline_serializer(
            name="PendingImageUploadRequest",
            fields={
                "image": serializers.ImageField(),
                "turnstile_token": serializers.CharField(required=False, allow_blank=True),
            },
        ),
        responses={
            201: inline_serializer(
                name="PendingImageUploadResponse",
                fields={
                    "token": serializers.CharField(),
                    "preview_url": serializers.URLField(),
                },
            ),
        },
    )
    def post(self, request, identifier: str):
        unit = get_object_or_404(Unit.objects.select_related("game"), identifier=identifier)
        pending = create_pending_upload(unit, request)
        return Response(
            {"token": pending.attach_token, "preview_url": pending.image.url},
            status=status.HTTP_201_CREATED,
        )
