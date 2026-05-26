import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { apiFetch } from '../../api';
import { logout } from '../../lib/allauthApi';

export default function DeleteAccountSection() {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch('/api/account/', { method: 'DELETE' });
      if (res.ok) {
        await logout();
        window.location.replace('/accounts/login/');
      } else {
        setError(t('settings.deleteAccount.confirmation.failed'));
        setSubmitting(false);
      }
    } catch {
      setError(t('common.unexpectedError'));
      setSubmitting(false);
    }
  }

  if (!expanded) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-char/70">
          {t('settings.deleteAccount.description')}
        </p>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="rounded-[4px] bg-ember px-[18px] py-[7px] text-sm font-semibold tracking-wide text-white transition-transform hover:-translate-y-px active:translate-y-0"
        >
          {t('settings.deleteAccount.deleteBtn')}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-card border border-ember/20 bg-ember/5 p-4">
      {error && <p className="text-sm text-ember">{error}</p>}
      <div className="space-y-2 text-sm text-char">
        <p className="font-semibold">
          {t('settings.deleteAccount.confirmation.title')}
        </p>
        <ul className="list-disc space-y-1 pl-5 text-char/80">
          <li>{t('settings.deleteAccount.confirmation.item1')}</li>
          <li>{t('settings.deleteAccount.confirmation.item2')}</li>
          <li>{t('settings.deleteAccount.confirmation.item3')}</li>
          <li>{t('settings.deleteAccount.confirmation.item4')}</li>
          <li>{t('settings.deleteAccount.confirmation.item5')}</li>
        </ul>
        <p className="text-char/70">
          {t('settings.deleteAccount.confirmation.keepAnon')}
        </p>
      </div>
      <p className="text-sm text-char">
        <Trans
          i18nKey="settings.deleteAccount.confirmation.typeToConfirm"
          components={{ strong: <strong /> }}
        />
      </p>
      <input
        type="text"
        value={confirmation}
        onChange={(e) => setConfirmation(e.target.value)}
        placeholder={t('settings.deleteAccount.confirmation.placeholder')}
        autoComplete="off"
        className="w-full rounded-input border border-char/20 px-3 py-2.5 text-sm text-char placeholder-smoke/60 focus:border-ember focus:outline-none focus:ring-2 focus:ring-ember/20"
      />
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleDelete}
          disabled={confirmation !== 'DELETE' || submitting}
          className="rounded-[4px] bg-ember px-[18px] py-[7px] text-sm font-semibold tracking-wide text-white transition-transform hover:-translate-y-px active:translate-y-0 disabled:pointer-events-none disabled:opacity-50"
        >
          {submitting
            ? `${t('settings.deleteAccount.confirmation.submit.loading')}…`
            : t('settings.deleteAccount.confirmation.submit.default')}
        </button>
        <button
          type="button"
          onClick={() => {
            setExpanded(false);
            setConfirmation('');
            setError(null);
          }}
          className="text-sm text-char/50 hover:text-char"
        >
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
}
