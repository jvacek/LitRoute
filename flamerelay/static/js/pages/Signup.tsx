import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { apiFetch } from '../api';
import brusselsImg from '../assets/journey/brussels.webp';
import { FieldErrors, NonFieldErrors } from '../components/AllauthErrors';
import { useAuth } from '../AuthContext';
import { getSession, type AllauthError } from '../lib/allauthApi';
import { reportError } from '../lib/sentry';
import { inputClass, labelClass, primaryBtn } from '../styles';

export default function Signup() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { refresh } = useAuth();
  const destination = searchParams.get('next') ?? '/';

  const [name, setName] = useState('');
  const [errors, setErrors] = useState<AllauthError[]>([]);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    getSession()
      .then((resp) => {
        if (!mounted) return;
        if (resp.meta?.is_authenticated) {
          apiFetch('/api/account/')
            .then((r) => r.json())
            .then((me: { name: string }) => {
              if (!mounted) return;
              setName(me.name ?? '');
              setReady(true);
            })
            .catch((err: unknown) => {
              reportError(err, { where: 'Signup.fetchAccount' });
              if (mounted) navigate('/accounts/login/');
            });
        } else {
          navigate('/accounts/login/');
        }
      })
      .catch((err: unknown) => {
        reportError(err, { where: 'Signup.getSession' });
        if (mounted) navigate('/accounts/login/');
      });
    return () => {
      mounted = false;
    };
  }, [navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors([]);
    setLoading(true);
    try {
      const resp = await apiFetch('/api/account/', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, language: i18n.resolvedLanguage ?? 'en' }),
      });
      if (resp.ok) {
        await refresh();
        navigate(destination, { replace: true });
      } else {
        setErrors([{ message: t('auth.signup.saveFailed') }]);
      }
    } finally {
      setLoading(false);
    }
  }

  if (!ready) return null;

  const previewDate = new Date().toLocaleDateString(i18n.resolvedLanguage, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  return (
    <main className="mx-auto mt-16 max-w-2xl px-4">
      <div className="flex flex-col gap-8 sm:flex-row sm:items-start">
        {/* Form */}
        <div className="min-w-0 flex-1 rounded-card border border-char/10 bg-white px-8 py-10 shadow-sm">
          <h1 className="font-heading mb-2 text-2xl font-bold text-char">
            {t('auth.signup.title')}
          </h1>
          <p className="mb-6 text-sm text-char/60">
            {t('auth.signup.description')}
          </p>
          <form onSubmit={handleSubmit} className="space-y-5">
            <NonFieldErrors errors={errors} />
            <div>
              <label htmlFor="name" className={labelClass}>
                {t('auth.signup.displayNameLabel')}
              </label>
              <input
                id="name"
                type="text"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className={inputClass}
              />
              <FieldErrors param="name" errors={errors} />
            </div>
            <button type="submit" disabled={loading} className={primaryBtn}>
              {loading
                ? `${t('common.saving')}…`
                : t('auth.signup.submit.default')}
            </button>
          </form>
        </div>

        {/* Live preview */}
        <div className="min-w-0 flex-1">
          <p className="mb-3 text-xs font-medium uppercase tracking-widest text-smoke/60">
            {t('auth.signup.previewLabel')}
          </p>
          <div className="overflow-hidden rounded-card border border-char/10 bg-white shadow-sm">
            <div className="flex items-center justify-between bg-linen/60 px-4 py-3">
              <span className="font-medium text-char">Brussels</span>
              <span className="text-xs text-smoke">{previewDate}</span>
            </div>
            <div className="aspect-[4/3] overflow-hidden">
              <img
                src={brusselsImg}
                alt=""
                aria-hidden="true"
                className="h-full w-full object-cover"
              />
            </div>
            <div className="flex flex-col p-4">
              <p className="mb-4 text-base text-char/80">
                Had a great time, leaving tomorrow!
              </p>
              <div className="flex min-w-0 justify-end">
                <span
                  className="min-w-0 truncate font-handwriting text-2xl text-char/60"
                  style={{ transform: 'rotate(-2deg)' }}
                >
                  {name || t('auth.signup.yourNameFallback')}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
