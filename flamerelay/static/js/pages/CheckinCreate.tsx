import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { apiFetch } from '../api';
import { useAuth } from '../AuthContext';
import { storeEditToken } from '../lib/editTokens';
import { useConfig } from '../lib/useConfig';
import CheckinForm from '../components/CheckinForm';
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

function LighterIllustration() {
  return (
    <img
      src="/static/images/illustrations/thankyou.svg"
      alt=""
      className="mx-auto mb-8 h-52 w-auto"
    />
  );
}

function GuestEmailCapture({
  identifier,
  checkinId,
  onDone,
}: {
  identifier: string;
  checkinId: number;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch(`/api/units/${identifier}/guest-subscribe/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, checkin_id: checkinId }),
      });
      if (res.ok) {
        setSent(true);
      } else {
        const json = (await res.json()) as { detail?: string };
        setError(json.detail ?? t('common.unexpectedError'));
      }
    } catch {
      setError(t('common.unexpectedError'));
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <main className="px-4 py-12">
        <div className="mx-auto max-w-sm rounded-2xl bg-white px-8 py-10 text-center shadow-sm">
          <LighterIllustration />
          <h1 className="font-heading mb-3 text-3xl font-bold text-char">
            {t('checkin.guestEmailSentTitle')}
          </h1>
          <p className="text-smoke">{t('checkin.guestEmailSent')}</p>
          <button
            type="button"
            onClick={onDone}
            className="mt-8 text-sm text-smoke underline hover:text-char"
          >
            {t('checkin.guestEmailSentBack')}
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="px-4 py-12">
      <div className="mx-auto max-w-sm rounded-2xl bg-white px-8 py-10 text-center shadow-sm">
        <LighterIllustration />
        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-ember">
          {t('checkin.checkedIn')}
        </p>
        <h1 className="font-heading mb-3 text-4xl font-bold text-char">
          {t('checkin.guestEmailTitle')}
        </h1>
        <p className="font-heading mb-1 text-base italic text-amber">
          {t('checkin.guestEmailTagline')}
        </p>
        <p className="mb-8 text-smoke">{t('checkin.guestEmailSubtitle')}</p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('checkin.guestEmailPlaceholder')}
            required
            className="w-full rounded-input border border-char/15 bg-linen px-4 py-3 text-center text-sm text-char placeholder-smoke/60 focus:border-amber focus:outline-none focus:ring-2 focus:ring-amber/20"
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-btn bg-amber px-[22px] py-[9px] text-sm font-semibold tracking-wide text-char transition-transform hover:-translate-y-px active:translate-y-0 disabled:pointer-events-none disabled:opacity-50"
          >
            {loading
              ? `${t('common.sending')}…`
              : t('checkin.guestEmailSubmit')}
          </button>
        </form>
        {error && <p className="mt-2 text-xs text-ember">{error}</p>}
        <button
          type="button"
          onClick={onDone}
          className="mt-4 text-sm text-smoke underline hover:text-char"
        >
          {t('checkin.guestEmailSkip')}
        </button>
      </div>
    </main>
  );
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
  const [gpsDriftAllowanceM, setGpsDriftAllowanceM] = useState<number | null>(
    null,
  );
  const [gameTimeWarning, setGameTimeWarning] = useState<string | null>(null);
  const [team, setTeam] = useState<TeamRef | null>(null);

  useEffect(() => {
    apiFetch(`/api/units/${identifier}/`).then(async (r) => {
      if (r.status === 404) {
        setNotFound(true);
        return;
      }
      if (r.ok) {
        const data = (await r.json()) as {
          is_gps_enforced: boolean;
          team: TeamRef | null;
          game: {
            name: string;
            mode: string;
            max_gps_drift: number;
            allowed_time: number;
            end_time: string;
          } | null;
        };
        setIsGpsEnforced(data.is_gps_enforced ?? false);
        setTeam(data.team ?? null);
        setGpsDriftAllowanceM(data.game?.max_gps_drift ?? 0);
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
      <GuestEmailCapture
        identifier={identifier}
        checkinId={guestCheckinId}
        onDone={() => navigate(unitUrl)}
      />
    );
  }

  if (gpsDriftAllowanceM === null) {
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
        unitIdentifier={identifier}
        maptilerKey={maptilerKey}
        isGpsEnforced={isGpsEnforced}
        gpsDriftAllowanceM={gpsDriftAllowanceM}
        onSubmit={handleSubmit}
      />
    </main>
  );
}
