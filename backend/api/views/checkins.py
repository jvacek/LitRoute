from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.exceptions import ValidationError
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
from backend.models import CheckIn, Unit
from config.constants import (
    CHECKIN_DELETE_GRACE_PERIOD_HOURS,
    CHECKIN_EDIT_GRACE_PERIOD_HOURS,
)

from ._checkin_helpers import (
    CheckinImageManager,
    CheckinValidator,
    check_authenticated_owner,
    check_edit_token,
    create_pending_upload,
    save_checkin_record,
)


class CheckInViewSet(ListModelMixin, CreateModelMixin, UpdateModelMixin, DestroyModelMixin, GenericViewSet):
    serializer_class = CheckInSerializer
    permission_classes = [IsAuthenticatedOrReadOnly]

    def get_permissions(self):
        if self.action in ("create", "destroy", "partial_update", "pending_images"):
            return [AllowAny()]
        return super().get_permissions()

    def get_queryset(self):
        return (
            CheckIn.objects.filter(unit__identifier=self.kwargs["identifier"])
            .select_related("created_by")
            .prefetch_related("images")
        )

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

    def perform_create(self, serializer):
        unit = get_object_or_404(Unit.objects.select_related("game"), identifier=self.kwargs["identifier"])
        # Fetched once and shared with CheckinValidator (gap, speed, can-check-in).
        previous = unit.checkin_set.order_by("-date_created").first()
        pending_image_tokens = serializer.validated_data.get("pending_image_tokens", [])

        CheckinValidator(unit, self.request, previous).run_create_checks(
            serializer.validated_data, pending_image_tokens
        )

        # Cache invalidation runs from the post_save signal in models.py.
        checkin = save_checkin_record(unit, serializer, self.request.user)
        CheckinImageManager(checkin, self.request).attach(pending_image_tokens)

    def partial_update(self, request, *args, **kwargs):
        if "location" in request.data:
            raise ValidationError({"location": ["Cannot be modified after creation."]})
        checkin = self.get_object()
        if not request.user.is_authenticated:
            check_edit_token(checkin, request, CHECKIN_EDIT_GRACE_PERIOD_HOURS)
        else:
            check_authenticated_owner(checkin, request.user, "edit", CHECKIN_EDIT_GRACE_PERIOD_HOURS)

        # Inlined from UpdateModelMixin.update so we don't re-fetch the checkin
        # via a second self.get_object() inside super().partial_update().
        serializer = self.get_serializer(checkin, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)
        pending_image_tokens = serializer.validated_data.get("pending_image_tokens", [])
        CheckinImageManager(checkin, request).update(pending_image_tokens)

        # Refresh after image mutations so the response reflects the new set.
        checkin.refresh_from_db()
        return Response(self.get_serializer(checkin).data)

    def destroy(self, request, *args, **kwargs):
        checkin = self.get_object()
        if not request.user.is_authenticated:
            check_edit_token(checkin, request, CHECKIN_DELETE_GRACE_PERIOD_HOURS)
        else:
            check_authenticated_owner(checkin, request.user, "delete", CHECKIN_DELETE_GRACE_PERIOD_HOURS)
        return super().destroy(request, *args, **kwargs)

    def perform_destroy(self, instance):
        # Cache invalidation runs from the post_delete signal in models.py.
        super().perform_destroy(instance)

    @transaction.non_atomic_requests
    def pending_images(self, request, *args, **kwargs):
        """Accept one image at a time, return `{ token, preview_url }`.

        Tokens are later passed back in `pending_image_tokens` on the
        check-in POST/PATCH. Splits the multi-photo upload across many
        small requests so the user gets per-photo progress and so each
        request stays well under nginx's 20 MB body cap.

        Marked `non_atomic_requests` because anon callers need a Django
        session row persisted *outside* a transaction that could roll
        back — if the view's atomic block rolled back a fresh session
        row, SessionMiddleware would raise SessionInterrupted on the
        response-phase save. The view writes exactly one CheckInImage
        row, so request-level atomicity isn't needed.
        """
        unit = get_object_or_404(Unit.objects.select_related("game"), identifier=self.kwargs["identifier"])
        pending = create_pending_upload(unit, request)
        return Response(
            {"token": pending.attach_token, "preview_url": pending.image.url},
            status=status.HTTP_201_CREATED,
        )
