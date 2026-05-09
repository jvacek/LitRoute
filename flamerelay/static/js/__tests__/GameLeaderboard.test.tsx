import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import GameLeaderboard from '../pages/GameLeaderboard';
import { apiFetch } from '../api';
import { useConfig } from '../lib/useConfig';

jest.mock('../api');
jest.mock('../lib/useConfig');
jest.mock('react-router-dom', () => ({
  useParams: () => ({ gameId: '1' }),
  useSearchParams: () => [new URLSearchParams(), jest.fn()],
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

const mockApiFetch = jest.mocked(apiFetch);
const mockUseConfig = jest.mocked(useConfig);

function makeGame(mode: string, sortBy: 'distance_km' | 'checkin_count') {
  return {
    id: 1,
    name: 'Test Game',
    mode,
    allowed_time: 24,
    max_gps_drift: 100,
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

function mockFetch(leaderboardData: object) {
  mockApiFetch.mockImplementation((url: string) =>
    Promise.resolve({
      ok: true,
      json: async () =>
        url.includes('/journeys/')
          ? { game_id: 1, journeys: [] }
          : leaderboardData,
    } as Response),
  );
}

function renderLeaderboard() {
  render(<GameLeaderboard />);
}

describe('GameLeaderboard check-in threshold filtering', () => {
  beforeEach(() => {
    mockUseConfig.mockReturnValue(null);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('hides distance-mode entries with fewer than 2 check-ins and shows a count row', async () => {
    mockFetch({
      game: makeGame('distance', 'distance_km'),
      individual: [
        makeEntry(1, 3, 344), // 3 check-ins → visible
        makeEntry(2, 1, 0), //  1 check-in  → hidden
        makeEntry(3, 1, 0), //  1 check-in  → hidden
      ],
      teams: null,
    });

    renderLeaderboard();

    await waitFor(() => expect(screen.getByText('#1')).toBeInTheDocument());
    expect(screen.queryByText('#2')).not.toBeInTheDocument();
    expect(screen.queryByText('#3')).not.toBeInTheDocument();
    expect(
      screen.getByText(/2 lighters haven't checked in yet/),
    ).toBeInTheDocument();
  });

  it('shows hot-potato entries with 1 check-in but hides those with 0', async () => {
    mockFetch({
      game: makeGame('hot_potato', 'checkin_count'),
      individual: [
        makeEntry(1, 2), // 2 check-ins → visible
        makeEntry(2, 1), // 1 check-in  → visible (threshold is 1 for hot potato)
        makeEntry(3, 0), // 0 check-ins → hidden
      ],
      teams: null,
    });

    renderLeaderboard();

    await waitFor(() => expect(screen.getByText('#1')).toBeInTheDocument());
    expect(screen.getByText('#2')).toBeInTheDocument();
    expect(screen.queryByText('#3')).not.toBeInTheDocument();
    expect(
      screen.getByText(/1 lighter hasn't checked in yet/),
    ).toBeInTheDocument();
  });
});
