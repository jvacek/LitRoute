export interface GameConfig {
  name: string;
  rulesKey: string;
  icon: string;
  hasLeaderboard: boolean;
}

const GAME_CONFIGS: Record<string, GameConfig> = {
  distance: {
    name: 'game.distance.name',
    rulesKey: 'game.distance.rules',
    icon: '📍',
    hasLeaderboard: true,
  },
  relay: {
    name: 'game.relay.name',
    rulesKey: 'game.relay.rules',
    icon: '🔥',
    hasLeaderboard: false,
  },
  race: {
    name: 'game.race.name',
    rulesKey: 'game.race.rules',
    icon: '🏁',
    hasLeaderboard: false,
  },
  hot_potato: {
    name: 'game.hot_potato.name',
    rulesKey: 'game.hot_potato.rules',
    icon: '🥔',
    hasLeaderboard: false,
  },
};

export function getGameConfig(
  mode: string | undefined | null,
): GameConfig | null {
  return mode ? (GAME_CONFIGS[mode] ?? null) : null;
}
