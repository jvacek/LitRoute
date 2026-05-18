import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLoaderData, useNavigate } from 'react-router-dom';
import { apiFetch } from '../api';
import { useAuth } from '../AuthContext';
import { reportError } from '../lib/sentry';
import type { UserFormLoaderData } from './UserForm.loader';

export default function UserForm() {
  const { t } = useTranslation();
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const updateUrl = '/api/account/';
  const loaderData = useLoaderData() as UserFormLoaderData;

  const [name, setName] = useState(loaderData.name);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErrors({});
    try {
      const res = await apiFetch(updateUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        await refresh();
        navigate('/profile/');
      } else if (res.status === 401) {
        await refresh();
        navigate('/accounts/login/');
      } else {
        const body = await res.json();
        setErrors(body as Record<string, string[]>);
      }
    } catch (e) {
      reportError(e, { where: 'UserForm.submit' });
      setErrors({ non_field_errors: [t('common.unexpectedError')] });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="font-heading mb-8 text-3xl font-bold text-char">
        {t('userForm.title')}
      </h1>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label
            htmlFor="name"
            className="mb-1 block text-sm font-medium text-char"
          >
            {t('common.nameLabel')}
          </label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('common.namePlaceholder')}
            className="w-full rounded-input border border-char/15 bg-white px-4 py-3 text-sm text-char placeholder-smoke/60 focus:border-amber focus:outline-none focus:ring-2 focus:ring-amber/20"
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

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="rounded-btn bg-amber px-[22px] py-[9px] text-sm font-semibold tracking-wide text-white transition-transform hover:-translate-y-px active:translate-y-0 disabled:pointer-events-none disabled:opacity-50"
          >
            {submitting
              ? `${t('common.saving')}…`
              : t('userForm.submit.default')}
          </button>
          <Link
            to="/profile/"
            className="rounded-btn border border-char/15 px-[22px] py-[9px] text-sm font-medium text-char transition-colors hover:bg-linen"
          >
            {t('common.cancel')}
          </Link>
        </div>
      </form>
    </main>
  );
}
