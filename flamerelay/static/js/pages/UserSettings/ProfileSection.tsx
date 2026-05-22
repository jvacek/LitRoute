import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../api';
import { reportError } from '../../lib/sentry';
import { inputClass, primaryBtnMd } from '../../styles';

export default function ProfileSection() {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  useEffect(() => {
    apiFetch('/api/account/')
      .then((r) => r.json())
      .then((data: { name: string }) => setName(data.name ?? ''))
      .finally(() => setLoading(false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErrors({});
    setSaved(false);
    try {
      const res = await apiFetch('/api/account/', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        setSaved(true);
      } else {
        const body = (await res.json()) as Record<string, string[]>;
        setErrors(body);
      }
    } catch (err) {
      reportError(err, { where: 'ProfileSection.submit' });
      setErrors({ non_field_errors: [t('common.unexpectedError')] });
    } finally {
      setSubmitting(false);
    }
  }

  if (loading)
    return <p className="text-sm text-char/50">{t('common.loading')}…</p>;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label
          htmlFor="name"
          className="mb-1 block text-sm font-medium text-char/70"
        >
          {t('common.nameLabel')}
        </label>
        <input
          id="name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('common.namePlaceholder')}
          className={inputClass}
        />
        {errors.name && (
          <p className="mt-1 text-xs text-ember">{errors.name.join(' ')}</p>
        )}
      </div>
      {errors.non_field_errors && (
        <p className="text-sm text-ember">
          {errors.non_field_errors.join(' ')}
        </p>
      )}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={submitting} className={primaryBtnMd}>
          {submitting
            ? `${t('common.saving')}…`
            : t('settings.profile.submit.default')}
        </button>
        {saved && (
          <span className="text-sm text-char/50">
            {t('settings.profile.saved')}
          </span>
        )}
      </div>
    </form>
  );
}
