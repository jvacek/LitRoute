import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { apiFetch } from '../api';
import { useAuth } from '../AuthContext';
import { storeEditToken } from '../lib/editTokens';
import { useConfig } from '../lib/useConfig';
import CheckinForm from '../components/CheckinForm';
import GuestEmailCapture from '../components/GuestEmailCapture';
import TeamBadge from '../components/TeamBadge';
import ErrorPage from './ErrorPage';

interface TeamRef {
  name: string;
  color: string;
}

interface CheckinResponse {
  id: number;
  edit_token?: string;
}

export default function CheckinCreate() {
  const { t } = useTranslation();
  const { identifier = '' } = useParams<{ identifier: string }>();
  const config = useConfig();
  const maptilerKey = config?.maptilerKey ?? '';
  const navigate = useNavigate();
  const { isAuthenticated, refresh } = useAuth();
  const unitUrl = `/unit/${identifier}/`;

  const [guestCheckinId, setGuestCheckinId] = useState<number | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [isGpsEnforced, setIsGpsEnforced] = useState(false);
  const [gpsDriftFloorM, setGpsDriftFloorM] = useState<number | null>(null);
  const [gameTimeWarning, setGameTimeWarning] = useState<string | null>(null);
  const [team, setTeam] = useState<TeamRef | null>(null);
  const [subscriberCount, setSubscriberCount] = useState(0);

  useEffect(() => {
    apiFetch(`/api/units/${identifier}/`).then(async (r) => {
      if (r.status === 404) {
        setNotFound(true);
        return;
      }
      if (r.ok) {
        const data = (await r.json()) as {
          is_gps_enforced: boolean;
          subscriber_count: number;
          team: TeamRef | null;
          game: {
            name: string;
            mode: string;
            gps_drift_floor: number;
            allowed_time: number;
            end_time: string;
          } | null;
        };
        setIsGpsEnforced(data.is_gps_enforced ?? false);
        setTeam(data.team ?? null);
        setSubscriberCount(data.subscriber_count ?? 0);
        setGpsDriftFloorM(data.game?.gps_drift_floor ?? 0);
        if (data.game?.mode === 'distance' && data.game.end_time) {
          const remainingMinutes =
            (new Date(data.game.end_time).getTime() - Date.now()) / 60_000;
          if (remainingMinutes <= 0) {
            setGameTimeWarning(t('game.distance.timeExpired'));
          } else if (remainingMinutes < 60) {
            setGameTimeWarning(
              t('game.distance.timeAlmostUp', {
                minutes: Math.ceil(remainingMinutes),
              }),
            );
          }
        }
      }
    });
  }, [identifier, t]);

  async function handleSubmit(data: FormData) {
    const res = await apiFetch(`/api/units/${identifier}/checkins/`, {
      method: 'POST',
      body: data,
    });
    if (res.status === 401) {
      await refresh();
      navigate('/accounts/login/');
      return null;
    }
    if (res.status === 201) {
      const json = (await res.json()) as CheckinResponse;
      if (!isAuthenticated && json.edit_token) {
        storeEditToken(json.id, json.edit_token);
        setGuestCheckinId(json.id);
      } else {
        navigate(unitUrl);
      }
      return null;
    }
    const json = (await res.json()) as Record<string, string[]> & {
      detail?: string;
    };
    if (json.detail) {
      return { non_field_errors: [json.detail] };
    }
    return json;
  }

  if (notFound) return <ErrorPage code={404} />;

  if (guestCheckinId !== null) {
    return (
      <main className="px-4 py-12">
        <GuestEmailCapture
          identifier={identifier}
          checkinId={guestCheckinId}
          subscriberCount={subscriberCount}
          onDone={() => navigate(unitUrl)}
        />
      </main>
    );
  }

  if (gpsDriftFloorM === null) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16 text-center text-smoke">
        {t('common.loading')}…
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="font-heading text-3xl font-bold text-char">
        {t('checkin.createTitle')}
      </h1>
      <div className="mb-8 mt-1 flex flex-wrap items-center gap-2 text-sm text-char/70">
        <span className="font-mono uppercase tracking-wide">{identifier}</span>
        {team && <TeamBadge name={team.name} color={team.color} />}
      </div>
      {gameTimeWarning && (
        <div className="mb-4 rounded-card border border-ember/40 bg-ember/10 px-4 py-3 text-sm text-char">
          ⚠︎ {gameTimeWarning}
        </div>
      )}
      <CheckinForm
        mode="create"
        unitUrl={unitUrl}
        maptilerKey={maptilerKey}
        isGpsEnforced={isGpsEnforced}
        gpsDriftFloorM={gpsDriftFloorM}
        onSubmit={handleSubmit}
      />
    </main>
  );
}
