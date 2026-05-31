// The leaderboard highlights the row of the unit the visitor came from. That
// "from" identifier used to ride in the URL (?from=alpha-01), which leaked the
// visitor's own unit identifier whenever they shared or bookmarked the link.
// We keep it in sessionStorage instead, keyed by game id: written when the user
// clicks through from a unit page, read by the leaderboard loader. A shared URL
// carries nothing, so the recipient sees no highlight (and the API nulls out
// every identifier when no ?from= is supplied).

const key = (gameId: number) => `leaderboard-from:${gameId}`;

export function setLeaderboardFrom(gameId: number, identifier: string): void {
  try {
    sessionStorage.setItem(key(gameId), identifier);
  } catch {
    /* storage unavailable (private mode / SSR) — highlight just won't persist */
  }
}

export function getLeaderboardFrom(gameId: number): string | null {
  try {
    return sessionStorage.getItem(key(gameId));
  } catch {
    return null;
  }
}
