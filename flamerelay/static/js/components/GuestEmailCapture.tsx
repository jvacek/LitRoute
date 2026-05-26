import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../api';
import { useTurnstileGate } from '../lib/useTurnstileGate';
import { amberCharBtnLg } from '../styles';

function LighterIllustration() {
  return (
    <img
      src="/static/images/illustrations/thankyou.svg"
      alt=""
      className="mx-auto mb-8 h-52 w-auto"
    />
  );
}

export default function GuestEmailCapture({
  identifier,
  checkinId,
  followerCount,
  onDone,
}: {
  identifier: string;
  checkinId: number;
  followerCount: number;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const {
    token: turnstileToken,
    widget: turnstileWidget,
    isReady: turnstileReady,
    reset: resetTurnstile,
  } = useTurnstileGate({ onRetry: () => setError('') });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!turnstileReady) {
      setError(t('common.captcha.pending'));
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch(`/api/units/${identifier}/guest-follow/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          checkin_id: checkinId,
          turnstile_token: turnstileToken,
        }),
      });
      if (res.ok) {
        setSent(true);
      } else {
        const json = (await res.json()) as { detail?: string };
        setError(json.detail ?? t('common.unexpectedError'));
        if (json.detail?.toLowerCase().includes('captcha')) {
          resetTurnstile();
        }
      }
    } catch {
      setError(t('common.unexpectedError'));
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div className="mx-auto max-w-sm rounded-card bg-white px-8 py-10 text-center shadow-sm">
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
    );
  }

  return (
    <div className="mx-auto max-w-sm rounded-card bg-white px-8 py-10 text-center shadow-sm">
      <LighterIllustration />
      <h1 className="font-heading mb-3 text-3xl font-bold text-char">
        {t('checkin.guestEmailTitle')}
      </h1>
      <p className="mb-6 text-smoke">{t('checkin.guestEmailSubtitle')}</p>
      {followerCount > 0 && (
        <p className="mb-4 text-sm font-medium text-amber">
          {t('checkin.guestEmailSocialProof', { count: followerCount })}
        </p>
      )}
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('checkin.guestEmailPlaceholder')}
          required
          autoFocus
          autoComplete="email"
          inputMode="email"
          className="w-full rounded-input border border-char/15 bg-linen px-4 py-3 text-center text-sm text-char placeholder-smoke/60 focus:border-amber focus:outline-none focus:ring-2 focus:ring-amber/20"
        />
        {turnstileWidget}
        <button
          type="submit"
          disabled={loading}
          className={`w-full ${amberCharBtnLg}`}
        >
          {loading ? `${t('common.sending')}…` : t('checkin.guestEmailSubmit')}
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
  );
}
