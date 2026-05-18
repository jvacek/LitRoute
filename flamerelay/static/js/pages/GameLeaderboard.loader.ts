import type { LoaderFunctionArgs } from 'react-router-dom';
import { apiClient } from '../api/client';
import type { components } from '../api/schema';

export type GameLeaderboardLoaderData = {
  leaderboard: components['schemas']['Leaderboard'];
  journeys: components['schemas']['GameJourneys'];
};

// Kept in a separate module so the loader stays eager — React Router can fire
// it the moment navigation starts, in parallel with the lazy GameLeaderboard
// chunk download. (If it lived in GameLeaderboard.tsx, the loader would only
// become available after the chunk arrived, defeating the parallelism.)
export async function gameLeaderboardLoader({
  params,
  request,
}: LoaderFunctionArgs): Promise<GameLeaderboardLoaderData> {
  const gameId = Number(params.gameId ?? 0);
  const from = new URL(request.url).searchParams.get('from');
  // Journey-map data is split off so the leaderboard table renders quickly
  // and the rank lookup on /unit/ doesn't pull megabytes of coordinates.
  const [leaderboardResp, journeysResp] = await Promise.all([
    apiClient.GET('/api/games/{id}/leaderboard/', {
      params: {
        path: { id: gameId, pk: gameId },
        query: from ? { from } : {},
      },
    }),
    apiClient.GET('/api/games/{id}/journeys/', {
      params: { path: { id: gameId, pk: gameId } },
    }),
  ]);
  if (leaderboardResp.response.status === 404 || !leaderboardResp.data) {
    throw new Response('Not Found', { status: 404 });
  }
  return {
    leaderboard: leaderboardResp.data,
    journeys: journeysResp.data ?? { game_id: gameId, journeys: [] },
  };
}
