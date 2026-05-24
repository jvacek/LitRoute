import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../api';
import { reportError } from '../../lib/sentry';

export default function NotificationsSection() {
  const { t } = useTranslation();
  const [receiveTyEmails, setReceiveTyEmails] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    apiFetch('/api/account/')
      .then((r) => r.json())
      .then((data: { receive_ty_emails?: boolean }) =>
        setReceiveTyEmails(data.receive_ty_emails ?? true),
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(
    () => () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    },
    [],
  );

  async function handleToggle(next: boolean) {
    const previous = receiveTyEmails;
    setReceiveTyEmails(next);
    setSaving(true);
    setError(null);
    setSavedFlash(false);
    try {
      const res = await apiFetch('/api/account/', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receive_ty_emails: next }),
      });
      if (!res.ok) {
        setReceiveTyEmails(previous);
        setError(t('common.unexpectedError'));
      } else {
        setSavedFlash(true);
        if (savedTimer.current) clearTimeout(savedTimer.current);
        savedTimer.current = setTimeout(() => setSavedFlash(false), 1500);
      }
    } catch (err) {
      reportError(err, { where: 'NotificationsSection.toggle' });
      setReceiveTyEmails(previous);
      setError(t('common.unexpectedError'));
    } finally {
      setSaving(false);
    }
  }

  if (loading)
    return <p className="text-sm text-char/50">{t('common.loading')}…</p>;

  return (
    <div className="space-y-3">
      <label className="flex items-start justify-between gap-4 cursor-pointer">
        <span className="flex-1">
          <span className="block text-sm font-medium text-char">
            {t('settings.notifications.thankYouLabel')}
          </span>
          <span className="mt-1 block text-xs text-char/60">
            {t('settings.notifications.thankYouHelp')}
          </span>
        </span>
        <span className="relative mt-1 inline-flex shrink-0">
          <input
            type="checkbox"
            checked={receiveTyEmails}
            disabled={saving}
            onChange={(e) => handleToggle(e.target.checked)}
            className="peer sr-only"
          />
          <span
            className="h-6 w-11 rounded-full bg-char/25 transition-colors peer-checked:bg-amber peer-focus-visible:ring-2 peer-focus-visible:ring-amber/40 peer-disabled:opacity-50"
            aria-hidden="true"
          />
          <span
            className="pointer-events-none absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5"
            aria-hidden="true"
          />
        </span>
      </label>
      {error && <p className="text-xs text-ember">{error}</p>}
      {savedFlash && !error && (
        <p className="text-xs text-char/50">
          {t('settings.notifications.saved')}
        </p>
      )}
    </div>
  );
}
