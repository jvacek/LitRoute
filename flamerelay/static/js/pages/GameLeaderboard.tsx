import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useSearchParams } from 'react-router-dom';
import { apiFetch } from '../api';
import Countdown from '../components/Countdown';
import JourneyMap, { type JourneyEntry } from '../components/JourneyMap';
import TeamBadge from '../components/TeamBadge';
import { humanizeHours } from '../lib/duration';
import { getGameConfig } from '../lib/gameConfig';
import { formatKm, formatNumber } from '../lib/numbers';
import { useConfig } from '../lib/useConfig';
import ErrorPage from './ErrorPage';

interface TeamRef {
  name: string;
  color: string;
}

interface IndividualEntry {
  rank: number;
  // Null for every row except the one matching the ?from=<identifier> query.
  identifier: string | null;
  place: string;
  last_checkin_name: string;
  distance_km: number;
  checkin_count: number;
  team: TeamRef | null;
}

interface TeamEntry {
  rank: number;
  team: TeamRef;
  distance_km: number;
  lighter_count: number;
}

interface LeaderboardData {
  game: {
    id: number;
    name: string;
    mode: string;
    allowed_time: number;
    gps_drift_floor: number;
    start_time: string;
    end_time: string;
    sort_by: 'distance_km' | 'checkin_count';
  };
  individual: IndividualEntry[];
  teams: TeamEntry[] | null;
}

const headerCell =
  'px-4 py-3 text-xs font-semibold uppercase tracking-wide text-char/60';
const dataCell = 'px-4 py-3 text-sm';

export default function GameLeaderboard() {
  const { t } = useTranslation();
  const { gameId = '' } = useParams<{ gameId: string }>();
  const [searchParams] = useSearchParams();
  const fromIdentifier = searchParams.get('from');
  const appConfig = useConfig();
  const maptilerKey = appConfig?.maptilerKey ?? '';
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [journeys, setJourneys] = useState<JourneyEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    // Pass ?from=<identifier> when known so that one row's identifier comes
    // through; everyone else's identifier is nulled out by the backend.
    let cancelled = false;
    const url = fromIdentifier
      ? `/api/games/${gameId}/leaderboard/?from=${encodeURIComponent(fromIdentifier)}`
      : `/api/games/${gameId}/leaderboard/`;
    apiFetch(url)
      .then(async (r) => {
        if (cancelled) return null;
        if (!r.ok) {
          setNotFound(true);
          return null;
        }
        return (await r.json()) as LeaderboardData;
      })
      .then((d) => {
        if (cancelled) return;
        if (d) setData(d);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [gameId, fromIdentifier]);

  useEffect(() => {
    // Journey-map data is split off so the leaderboard table renders quickly
    // and the rank lookup on /unit/ doesn't pull megabytes of coordinates.
    let cancelled = false;
    apiFetch(`/api/games/${gameId}/journeys/`)
      .then(async (r) => {
        if (cancelled || !r.ok) return null;
        return (await r.json()) as {
          game_id: number;
          journeys: JourneyEntry[];
        };
      })
      .then((d) => {
        if (cancelled || !d) return;
        setJourneys(d.journeys);
      });
    return () => {
      cancelled = true;
    };
  }, [gameId]);

  if (notFound) return <ErrorPage code={404} />;
  if (loading || !data) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 text-center text-char/60">
        {t('common.loading')}…
      </div>
    );
  }

  const config = getGameConfig(data.game.mode);
  const modeName = config ? t(config.name) : data.game.mode;
  const rules = config
    ? t(config.rulesKey, {
        duration: humanizeHours(t, data.game.allowed_time),
        maxDrift: formatNumber(data.game.gps_drift_floor),
      })
    : null;

  const isByCheckins = data.game.sort_by === 'checkin_count';
  const minCC = isByCheckins ? 1 : 2;
  const activeEntries = data.individual.filter((r) => r.checkin_count >= minCC);
  const notStartedCount = data.individual.length - activeEntries.length;

  const scoreHeader = isByCheckins
    ? t('game.leaderboard.checkinsHeader')
    : t('game.leaderboard.distanceHeader');
  const teamsDescription = isByCheckins
    ? t('game.leaderboard.teamsDescriptionByCheckins')
    : t('game.leaderboard.teamsDescriptionByDistance');
  const lightersDescription = isByCheckins
    ? t('game.leaderboard.lightersDescriptionByCheckins')
    : t('game.leaderboard.lightersDescriptionByDistance');
  const getRowScore = (row: IndividualEntry) =>
    isByCheckins
      ? formatNumber(row.checkin_count)
      : `${formatKm(row.distance_km)} km`;
  const getTeamScore = (team: TeamEntry) =>
    isByCheckins
      ? formatNumber(team.lighter_count)
      : `${formatKm(team.distance_km)} km`;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="font-heading text-2xl font-bold text-char sm:text-3xl">
        {t('game.leaderboard.title', { name: data.game.name })}
      </h1>
      <p className="mt-1 text-sm uppercase tracking-wide text-char/60">
        {modeName}
      </p>

      <div className="mt-6">
        <Countdown endTime={data.game.end_time} />
      </div>

      {rules && (
        <p className="mt-6 rounded-card border border-char/10 bg-linen/60 px-4 py-3 text-sm leading-relaxed text-char/80">
          {rules}
        </p>
      )}

      {data.teams && data.teams.length > 0 && (
        <section className="mt-8">
          <h2 className="font-heading text-xl font-bold text-char">
            {t('game.leaderboard.teamsTab')}
          </h2>
          <p className="mb-3 mt-1 text-sm text-char/60">{teamsDescription}</p>
          <div
            role="table"
            className="grid grid-cols-[auto_1fr_auto_auto] overflow-hidden rounded-card border border-char/10 bg-parchment"
          >
            <div role="row" className="col-span-full grid grid-cols-subgrid">
              <div role="columnheader" className={headerCell}>
                {t('game.leaderboard.rankHeader')}
              </div>
              <div role="columnheader" className={headerCell}>
                {t('game.leaderboard.teamHeader')}
              </div>
              <div role="columnheader" className={`${headerCell} text-right`}>
                {scoreHeader}
              </div>
              <div role="columnheader" className={`${headerCell} text-right`}>
                {t('game.leaderboard.lighterCountHeader')}
              </div>
            </div>
            {data.teams.map((team) => (
              <div
                role="row"
                key={team.team.name}
                className="col-span-full grid grid-cols-subgrid items-baseline border-t border-char/10"
              >
                <div
                  role="cell"
                  className={`${dataCell} font-heading text-base font-bold text-amber`}
                >
                  #{team.rank}
                </div>
                <div role="cell" className={dataCell}>
                  <TeamBadge name={team.team.name} color={team.team.color} />
                </div>
                <div
                  role="cell"
                  className={`${dataCell} text-right tabular-nums text-char`}
                >
                  {getTeamScore(team)}
                </div>
                <div
                  role="cell"
                  className={`${dataCell} text-right tabular-nums text-char/60`}
                >
                  {formatNumber(team.lighter_count)}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {journeys.length > 0 && (
        <section className="mt-8">
          <h2 className="font-heading text-xl font-bold text-char">
            {t('game.leaderboard.mapTitle')}
          </h2>
          <p className="mb-3 mt-1 text-sm text-char/60">
            {t('game.leaderboard.mapDescription')}
          </p>
          <JourneyMap entries={journeys} maptilerKey={maptilerKey} />
        </section>
      )}

      {data.individual.length === 0 ? (
        <p className="mt-8 text-char/60">{t('game.leaderboard.noEntries')}</p>
      ) : (
        <section className="mt-8">
          <h2 className="font-heading text-xl font-bold text-char">
            {t('game.leaderboard.individualTab')}
          </h2>
          <p className="mb-3 mt-1 text-sm text-char/60">
            {lightersDescription}
          </p>
          <div
            role="table"
            className="grid grid-cols-[auto_1fr_auto_auto] overflow-hidden rounded-card border border-char/10 bg-parchment"
          >
            <div role="row" className="col-span-full grid grid-cols-subgrid">
              <div role="columnheader" className={headerCell}>
                {t('game.leaderboard.rankHeader')}
              </div>
              <div role="columnheader" className={headerCell}>
                {t('game.leaderboard.placeHeader')}
              </div>
              <div role="columnheader" className={`${headerCell} text-right`}>
                {scoreHeader}
              </div>
              <div role="columnheader" className={headerCell}>
                {t('game.leaderboard.teamHeader')}
              </div>
            </div>
            {activeEntries.map((row) => {
              // identifier is null for every row except the ?from= one, so
              // matching null-to-null doesn't accidentally highlight a row.
              const isFrom =
                row.identifier != null && fromIdentifier === row.identifier;
              const rowClass = isFrom
                ? 'col-span-full grid grid-cols-subgrid items-baseline border-t border-char/10 bg-char text-white'
                : 'col-span-full grid grid-cols-subgrid items-baseline border-t border-char/10';
              const rankColor = isFrom ? 'text-white' : 'text-amber';
              const primary = isFrom ? 'text-white' : 'text-char';
              const muted = isFrom ? 'text-white/75' : 'text-char/60';
              return (
                <div role="row" key={row.rank} className={rowClass}>
                  <div
                    role="cell"
                    className={`${dataCell} font-heading text-base font-bold ${rankColor}`}
                  >
                    #{row.rank}
                  </div>
                  <div role="cell" className={`${dataCell} ${primary}`}>
                    <div className="font-medium">
                      {row.place || '—'}
                      {isFrom && (
                        <span
                          className={`ml-2 text-xs uppercase tracking-wide ${muted}`}
                        >
                          ({row.identifier})
                        </span>
                      )}
                    </div>
                    {row.last_checkin_name && (
                      <div className={`mt-0.5 text-xs ${muted}`}>
                        {t('game.leaderboard.byPerson', {
                          name: row.last_checkin_name,
                        })}
                      </div>
                    )}
                  </div>
                  <div
                    role="cell"
                    className={`${dataCell} text-right tabular-nums ${primary}`}
                  >
                    {getRowScore(row)}
                  </div>
                  <div role="cell" className={dataCell}>
                    {row.team ? (
                      <TeamBadge name={row.team.name} color={row.team.color} />
                    ) : (
                      <span className={muted}>—</span>
                    )}
                  </div>
                </div>
              );
            })}
            {notStartedCount > 0 && (
              <div
                role="row"
                className="col-span-full border-t border-char/10 bg-smoke"
              >
                <div role="cell" className={`${dataCell} italic text-white`}>
                  {t('game.leaderboard.unitsNotStarted', {
                    count: notStartedCount,
                  })}
                </div>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
