import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLoaderData, useNavigate, useParams } from 'react-router';
import { apiFetch } from '../api';
import { useAuth } from '../AuthContext';
import { storeEditToken } from '../lib/editTokens';
import { uploadPendingImage } from '../lib/uploadPendingImage';
import { useConfig } from '../lib/useConfig';
import CheckinForm, {
  type CheckinSubmitPayload,
} from '../components/CheckinForm';
import GuestEmailCapture from '../components/GuestEmailCapture';
import TeamBadge from '../components/TeamBadge';
import type { CheckinCreateLoaderData } from './CheckinCreate.loader';

interface CheckinResponse {
  id: number;
  edit_token?: string;
}

export default function CheckinCreate() {
  const { t } = useTranslation();
  const { identifier = '' } = useParams<{ identifier: string }>();
  const { maptilerKey } = useConfig();
  const navigate = useNavigate();
  const { isAuthenticated, refresh } = useAuth();
  const unitUrl = `/unit/${identifier}/`;

  const { unit } = useLoaderData() as CheckinCreateLoaderData;
  const isGpsEnforced = unit.is_gps_enforced ?? false;
  const team = unit.team;
  const followerCount = unit.follower_count;
  const gpsDriftFloorM = unit.game?.gps_drift_floor ?? 0;

  const [guestCheckinId, setGuestCheckinId] = useState<number | null>(null);
  // Computed at mount only — `Date.now()` is impure during render and unit.game
  // is fixed from the loader, so a useState initializer is the right home.
  const [gameTimeWarning] = useState<string | null>(() => {
    if (unit.game?.mode !== 'distance' || !unit.game.end_time) return null;
    const remainingMinutes =
      (new Date(unit.game.end_time).getTime() - Date.now()) / 60_000;
    if (remainingMinutes <= 0) return t('game.distance.timeExpired');
    if (remainingMinutes < 60) {
      return t('game.distance.timeAlmostUp', {
        minutes: Math.ceil(remainingMinutes),
      });
    }
    return null;
  });

  useEffect(() => {
    if (guestCheckinId !== null) {
      window.scrollTo(0, 0);
    }
  }, [guestCheckinId]);

  async function handleUploadImage(file: File, turnstileToken?: string) {
    return await uploadPendingImage(identifier, file, { turnstileToken });
  }

  async function handleSubmit(payload: CheckinSubmitPayload) {
    const res = await apiFetch(`/api/units/${identifier}/checkins/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
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
    let json: (Record<string, string[]> & { detail?: string }) | null = null;
    try {
      json = (await res.json()) as Record<string, string[]> & {
        detail?: string;
      };
    } catch {
      return { non_field_errors: [t('common.unexpectedError')] };
    }
    if (json.detail) {
      return { non_field_errors: [json.detail] };
    }
    return json;
  }

  if (guestCheckinId !== null) {
    return (
      <main className="px-4 py-12">
        <GuestEmailCapture
          identifier={identifier}
          checkinId={guestCheckinId}
          followerCount={followerCount}
          onDone={() => navigate(unitUrl)}
        />
      </main>
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
        onUploadImage={handleUploadImage}
        onSubmit={handleSubmit}
      />
    </main>
  );
}
