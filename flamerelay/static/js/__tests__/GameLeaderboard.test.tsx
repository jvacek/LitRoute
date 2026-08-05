import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import GameLeaderboard from '../pages/GameLeaderboard';
import type { GameLeaderboardLoaderData } from '../pages/GameLeaderboard.loader';
import { useConfig } from '../lib/useConfig';

let mockLoaderData: GameLeaderboardLoaderData;

jest.mock('../lib/useConfig');
jest.mock('react-router', () => ({
  useParams: () => ({ gameId: '1' }),
  useLoaderData: () => mockLoaderData,
}));
// JourneyMap uses WebGL which isn't available in jsdom
jest.mock('../components/JourneyMap', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../components/Countdown', () => ({
  __esModule: true,
  default: () => null,
}));

const mockUseConfig = jest.mocked(useConfig);

function makeGame(mode: string, sortBy: 'distance_km' | 'checkin_count') {
  return {
    id: 1,
    name: 'Test Game',
    mode: mode as GameLeaderboardLoaderData['leaderboard']['game']['mode'],
    allowed_time: 24,
    gps_drift_floor: 100,
    start_time: new Date().toISOString(),
    end_time: new Date(Date.now() + 86400000).toISOString(),
    sort_by: sortBy,
  };
}

function makeEntry(rank: number, checkinCount: number, distanceKm: number = 0) {
  return {
    rank,
    identifier: null,
    place: 'London',
    last_checkin_name: 'Alice',
    distance_km: distanceKm,
    checkin_count: checkinCount,
    team: null,
  };
}

function setLoaderData(
  leaderboardData: GameLeaderboardLoaderData['leaderboard'],
) {
  mockLoaderData = {
    leaderboard: leaderboardData,
    journeys: { game_id: 1, journeys: [] },
    from: null,
  };
}

function renderLeaderboard() {
  render(<GameLeaderboard />);
}

describe('GameLeaderboard check-in threshold filtering', () => {
  beforeEach(() => {
    mockUseConfig.mockReturnValue({
      maptilerKey: '',
      allowRegistration: false,
      turnstileSiteKey: '',
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('hides distance-mode entries with fewer than 2 check-ins and shows a count row', () => {
    setLoaderData({
      game: makeGame('distance', 'distance_km'),
      individual: [
        makeEntry(1, 3, 344), // 3 check-ins → visible
        makeEntry(2, 1, 0), //  1 check-in  → hidden
        makeEntry(3, 1, 0), //  1 check-in  → hidden
      ],
      teams: null,
    });

    renderLeaderboard();

    expect(screen.getByText('#1')).toBeInTheDocument();
    expect(screen.queryByText('#2')).not.toBeInTheDocument();
    expect(screen.queryByText('#3')).not.toBeInTheDocument();
    expect(
      screen.getByText(/2 lighters haven't checked in yet/),
    ).toBeInTheDocument();
  });

  it('shows hot-potato entries with 1 check-in but hides those with 0', () => {
    setLoaderData({
      game: makeGame('hot_potato', 'checkin_count'),
      individual: [
        makeEntry(1, 2), // 2 check-ins → visible
        makeEntry(2, 1), // 1 check-in  → visible (threshold is 1 for hot potato)
        makeEntry(3, 0), // 0 check-ins → hidden
      ],
      teams: null,
    });

    renderLeaderboard();

    expect(screen.getByText('#1')).toBeInTheDocument();
    expect(screen.getByText('#2')).toBeInTheDocument();
    expect(screen.queryByText('#3')).not.toBeInTheDocument();
    expect(
      screen.getByText(/1 lighter hasn't checked in yet/),
    ).toBeInTheDocument();
  });
});
