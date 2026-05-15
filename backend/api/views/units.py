from django.db.models import Count
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.mixins import RetrieveModelMixin
from rest_framework.permissions import AllowAny, IsAuthenticatedOrReadOnly
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet

from backend.api.serializers import UnitSerializer
from backend.models import Unit


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
