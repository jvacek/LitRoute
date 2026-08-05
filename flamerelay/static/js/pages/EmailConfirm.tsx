import { useState, useEffect } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';

import {
  getEmailVerification,
  verifyEmail,
  type AllauthError,
} from '../lib/allauthApi';
import { NonFieldErrors } from '../components/AllauthErrors';
import { primaryBtn } from '../styles';

type Step = 'loading' | 'confirm' | 'invalid' | 'done';

export default function EmailConfirm() {
  const { t } = useTranslation();
  const { key = '' } = useParams<{ key: string }>();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>(key ? 'loading' : 'invalid');
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<AllauthError[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!key) return;
    getEmailVerification(key).then((resp) => {
      if (
        resp.status === 200 &&
        resp.data &&
        !Array.isArray(resp.data) &&
        resp.data.email
      ) {
        setEmail(resp.data.email as string);
        setStep('confirm');
      } else {
        setErrors(resp.errors ?? []);
        setStep('invalid');
      }
    });
  }, [key]);

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErrors([]);
    try {
      const resp = await verifyEmail(key);
      if (resp.status === 200) {
        navigate('/accounts/login/');
        return;
      }
      setErrors(resp.errors ?? [{ message: t('emailConfirm.confirm.failed') }]);
    } finally {
      setLoading(false);
    }
  }

  if (step === 'loading') {
    return (
      <main className="mx-4 mt-16 max-w-md rounded-card border border-char/10 bg-white px-8 py-10 shadow-sm sm:mx-auto">
        <p className="text-sm text-char/60">
          {t('emailConfirm.checkingLink')}…
        </p>
      </main>
    );
  }

  if (step === 'invalid') {
    return (
      <main className="mx-4 mt-16 max-w-md rounded-card border border-char/10 bg-white px-8 py-10 shadow-sm sm:mx-auto">
        <h1 className="font-heading mb-2 text-2xl font-bold text-char">
          {t('emailConfirm.invalid.title')}
        </h1>
        <p className="text-sm text-char/70">
          <Trans
            i18nKey="emailConfirm.invalid.body"
            components={{
              requestNewLink: (
                <Link
                  to="/profile/settings/"
                  className="font-medium text-amber hover:opacity-80"
                />
              ),
            }}
          />
        </p>
        {errors.length > 0 && <NonFieldErrors errors={errors} />}
      </main>
    );
  }

  return (
    <main className="mx-4 mt-16 max-w-md rounded-card border border-char/10 bg-white px-8 py-10 shadow-sm sm:mx-auto">
      <h1 className="font-heading mb-2 text-2xl font-bold text-char">
        {t('emailConfirm.confirm.title')}
      </h1>
      <p className="mb-6 text-sm text-char/70">
        <Trans
          i18nKey="emailConfirm.confirm.body"
          values={{ email }}
          components={{ strong: <strong /> }}
        />
      </p>
      <form onSubmit={handleConfirm} className="space-y-5">
        <NonFieldErrors errors={errors} />
        <button type="submit" disabled={loading} className={primaryBtn}>
          {loading
            ? `${t('common.confirming')}…`
            : t('emailConfirm.confirm.submit.default')}
        </button>
      </form>
    </main>
  );
}
