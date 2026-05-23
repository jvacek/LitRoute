from django.conf import settings
from django.urls import path
from rest_framework.routers import DefaultRouter, SimpleRouter

from backend.api.views import (
    CheckInViewSet,
    ConfigView,
    FeedbackView,
    GameJourneysView,
    GameLeaderboardView,
    GlobePinsView,
    GuestFollowView,
    GuestVerifyView,
    PendingImageUploadView,
    StatsView,
    UnitViewSet,
    sentry_tunnel,
)
from flamerelay.users.api.views import (
    AccountFollowsView,
    AccountView,
    RequestCodeView,
    SocialAccountDisconnectView,
)

router = DefaultRouter() if settings.DEBUG else SimpleRouter()

app_name = "api"
urlpatterns = [
    *router.urls,
    path("account/", AccountView.as_view(), name="account"),
    path("account/follows/", AccountFollowsView.as_view(), name="account-follows"),
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
        "units/<str:identifier>/pending-images/",
        PendingImageUploadView.as_view(),
        name="pending-images",
    ),
    path(
        "units/<str:identifier>/checkins/<int:pk>/",
        CheckInViewSet.as_view({"patch": "partial_update", "delete": "destroy"}),
        name="checkin-detail",
    ),
    path(
        "units/<str:identifier>/follow/",
        UnitViewSet.as_view({"post": "follow", "delete": "unfollow"}),
        name="unit-follow",
    ),
    path("games/<int:pk>/leaderboard/", GameLeaderboardView.as_view(), name="game-leaderboard"),
    path("games/<int:pk>/journeys/", GameJourneysView.as_view(), name="game-journeys"),
    path("config/", ConfigView.as_view(), name="config"),
    path("stats/", StatsView.as_view(), name="stats"),
    path("globe-pins/", GlobePinsView.as_view(), name="globe-pins"),
    path("auth/code/request/", RequestCodeView.as_view(), name="auth-code-request"),
    path("account/social-accounts/", SocialAccountDisconnectView.as_view(), name="account-social-accounts"),
    path("units/<str:identifier>/guest-follow/", GuestFollowView.as_view(), name="guest-follow"),
    path("guest-verify/", GuestVerifyView.as_view(), name="guest-verify"),
    path("feedback/", FeedbackView.as_view(), name="feedback"),
    path("sentry/envelope/", sentry_tunnel, name="sentry-tunnel"),
]
