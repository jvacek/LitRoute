from django.conf import settings
from django.urls import path
from rest_framework.routers import DefaultRouter, SimpleRouter

from backend.api.views import (
    CheckInViewSet,
    ConfigView,
    GlobePinsView,
    GuestSubscribeView,
    GuestVerifyView,
    LocationClaimView,
    StatsView,
    UnitViewSet,
)
from flamerelay.users.api.views import (
    AccountSubscriptionsView,
    AccountView,
    RequestCodeView,
    SocialAccountDisconnectView,
)

router = DefaultRouter() if settings.DEBUG else SimpleRouter()

app_name = "api"
urlpatterns = [
    *router.urls,
    path("account/", AccountView.as_view(), name="account"),
    path("account/subscriptions/", AccountSubscriptionsView.as_view(), name="account-subscriptions"),
    path(
        "units/<str:identifier>/",
        UnitViewSet.as_view({"get": "retrieve"}),
        name="unit-detail",
    ),
    path(
        "units/<str:identifier>/checkins/",
        CheckInViewSet.as_view({"get": "list", "post": "create"}),
        name="checkin-list",
    ),
    path(
        "units/<str:identifier>/checkins/<int:pk>/",
        CheckInViewSet.as_view({"patch": "partial_update", "delete": "destroy"}),
        name="checkin-detail",
    ),
    path(
        "units/<str:identifier>/subscribe/",
        UnitViewSet.as_view({"post": "subscribe", "delete": "unsubscribe"}),
        name="unit-subscribe",
    ),
    path("location-claim/", LocationClaimView.as_view(), name="location-claim"),
    path("config/", ConfigView.as_view(), name="config"),
    path("stats/", StatsView.as_view(), name="stats"),
    path("globe-pins/", GlobePinsView.as_view(), name="globe-pins"),
    path("auth/code/request/", RequestCodeView.as_view(), name="auth-code-request"),
    path("account/social-accounts/", SocialAccountDisconnectView.as_view(), name="account-social-accounts"),
    path("units/<str:identifier>/guest-subscribe/", GuestSubscribeView.as_view(), name="guest-subscribe"),
    path("guest-verify/", GuestVerifyView.as_view(), name="guest-verify"),
]
