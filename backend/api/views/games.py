from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from backend.api.serializers import GameJourneysSerializer, LeaderboardSerializer
from backend.models import Game


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
