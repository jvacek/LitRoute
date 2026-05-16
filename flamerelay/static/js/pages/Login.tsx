import { useCallback, useEffect, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  startAuthentication,
  browserSupportsWebAuthn,
  WebAuthnAbortService,
} from '@simplewebauthn/browser';
import {
  requestLoginCode,
  confirmLoginCode,
  mfaAuthenticate,
  getSession,
  hasPendingFlow,
  getPasskeyLoginOptions,
  passkeyLogin,
  getWebAuthnMfaOptions,
  submitWebAuthnMfa,
  type AllauthError,
  type AllauthResponse,
} from '../lib/allauthApi';
import { apiFetch } from '../api';
import { FieldErrors, NonFieldErrors } from '../components/AllauthErrors';
import SocialProviders from '../components/SocialProviders';
import { inputClass, labelClass, primaryBtn } from '../styles';
import { useAuth } from '../AuthContext';

type Step = 'email' | 'code' | 'mfa';

interface MeData {
  username: string;
  name: string;
}

export default function Login() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { refresh } = useAuth();
  const destination = searchParams.get('next') ?? '/profile/';

  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [errors, setErrors] = useState<AllauthError[]>([]);
  const [loading, setLoading] = useState(false);
  const [mfaHasWebAuthn, setMfaHasWebAuthn] = useState(false);
  const conditionalPasskeyStarted = useRef(false);

  const checkNameThenRedirect = useCallback(async () => {
    try {
      const resp = await apiFetch('/api/account/');
      if (resp.ok) {
        const me = (await resp.json()) as MeData;
        if (!me.name) {
          const next =
            destination !== '/'
              ? `/accounts/signup/?next=${encodeURIComponent(destination)}`
              : '/accounts/signup/';
          navigate(next, { replace: true });
          return;
        }
      }
    } catch {
      // fall through to redirect
    }
    await refresh();
    navigate(destination, { replace: true });
  }, [destination, navigate, refresh]);

  const handleAuthResponse = useCallback(
    (resp: AllauthResponse) => {
      if (resp.status === 200 && resp.meta?.is_authenticated) {
        void checkNameThenRedirect();
        return;
      }
      if (resp.status === 401) {
        if (hasPendingFlow(resp, 'mfa_authenticate')) {
          setErrors([]);
          setCode('');
          setStep('mfa');
          return;
        }
      }
      setErrors(resp.errors ?? [{ message: t('auth.errors.somethingWrong') }]);
    },
    [checkNameThenRedirect, t],
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('error')) {
      // Allauth redirects here with ?error=&error_process=login when the OAuth
      // state cookie is lost (SameSite drops, slow flows, mobile webview handoff).
      setErrors([{ message: t('auth.errors.socialLoginFailed') }]);
      params.delete('error');
      params.delete('error_process');
      const qs = params.toString();
      window.history.replaceState(
        {},
        '',
        window.location.pathname + (qs ? `?${qs}` : ''),
      );
    }
    const urlCode = params.get('code');
    if (urlCode) {
      setLoading(true);
      confirmLoginCode(urlCode)
        .then((resp) => handleAuthResponse(resp))
        .catch(() => {
          setErrors([{ message: t('auth.errors.verifyFailed') }]);
        })
        .finally(() => setLoading(false));
      return;
    }
    getSession()
      .then((resp) => {
        if (resp.meta?.is_authenticated) {
          void checkNameThenRedirect();
        } else if (hasPendingFlow(resp, 'mfa_authenticate')) {
          getWebAuthnMfaOptions()
            .then((r) => {
              if (r.status === 200) setMfaHasWebAuthn(true);
            })
            .catch(() => {});
          setStep('mfa');
        } else if (hasPendingFlow(resp, 'login_by_code')) {
          setStep('code');
        }
      })
      .catch(() => {});
  }, [checkNameThenRedirect, handleAuthResponse, t]);

  useEffect(() => {
    if (conditionalPasskeyStarted.current) return;
    conditionalPasskeyStarted.current = true;

    async function startConditionalPasskey() {
      if (
        !window.PublicKeyCredential?.isConditionalMediationAvailable ||
        !(await window.PublicKeyCredential.isConditionalMediationAvailable())
      )
        return;
      try {
        const options = await getPasskeyLoginOptions();
        const credential = await startAuthentication({
          optionsJSON: options,
          useBrowserAutofill: true,
        });
        handleAuthResponse(await passkeyLogin(credential));
      } catch {
        // dismissed, timed out, or no passkey — fall through to email flow
      }
    }

    void startConditionalPasskey();
    return () => WebAuthnAbortService.cancelCeremony();
  }, [handleAuthResponse]);

  async function signInWithPasskey() {
    WebAuthnAbortService.cancelCeremony();
    setErrors([]);
    setLoading(true);
    try {
      const options = await getPasskeyLoginOptions();
      const credential = await startAuthentication({ optionsJSON: options });
      handleAuthResponse(await passkeyLogin(credential));
    } catch {
      setErrors([{ message: t('auth.errors.passkeyFailed') }]);
    } finally {
      setLoading(false);
    }
  }

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    WebAuthnAbortService.cancelCeremony();
    setErrors([]);
    setLoading(true);
    try {
      const result = await requestLoginCode(email);
      if (result.ok) {
        setStep('code');
      } else {
        setErrors([{ message: result.detail ?? t('auth.errors.sendFailed') }]);
      }
    } finally {
      setLoading(false);
    }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setErrors([]);
    setLoading(true);
    try {
      handleAuthResponse(await confirmLoginCode(code));
    } finally {
      setLoading(false);
    }
  }

  async function submitMfa(e: React.FormEvent) {
    e.preventDefault();
    setErrors([]);
    setLoading(true);
    try {
      handleAuthResponse(await mfaAuthenticate(code));
    } finally {
      setLoading(false);
    }
  }

  if (step === 'mfa') {
    return (
      <main className="mx-4 mt-16 max-w-md rounded-card border border-char/10 bg-white px-8 py-10 shadow-sm sm:mx-auto">
        <h1 className="font-heading mb-1 text-2xl font-bold text-char">
          {t('common.twoFactorAuth')}
        </h1>
        <p className="mb-6 text-sm text-char/60">{t('auth.mfa.description')}</p>
        <NonFieldErrors errors={errors} />
        {mfaHasWebAuthn && (
          <div className="mb-5">
            <button
              type="button"
              disabled={loading}
              className={primaryBtn}
              onClick={async () => {
                setErrors([]);
                setLoading(true);
                try {
                  const optResp = await getWebAuthnMfaOptions();
                  const credential = await startAuthentication({
                    optionsJSON: (
                      optResp as unknown as {
                        data: {
                          request_options: {
                            publicKey: Parameters<
                              typeof startAuthentication
                            >[0]['optionsJSON'];
                          };
                        };
                      }
                    ).data.request_options.publicKey,
                  });
                  handleAuthResponse(await submitWebAuthnMfa(credential));
                } catch {
                  setErrors([{ message: t('auth.errors.passkeyMfaFailed') }]);
                } finally {
                  setLoading(false);
                }
              }}
            >
              {loading
                ? `${t('common.verifying')}…`
                : t('auth.mfa.passkey.default')}
            </button>
            <p className="mt-4 text-center text-sm text-char/50">
              {t('common.or')}
            </p>
          </div>
        )}
        <form onSubmit={submitMfa} className="space-y-5">
          <div>
            <label htmlFor="mfa-code" className={labelClass}>
              {t('auth.mfa.codeLabel')}
            </label>
            <input
              id="mfa-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              required
              className={`${inputClass} text-center tracking-widest`}
            />
            <FieldErrors param="code" errors={errors} />
          </div>
          <button type="submit" disabled={loading} className={primaryBtn}>
            {loading
              ? `${t('common.verifying')}…`
              : t('auth.mfa.submit.default')}
          </button>
        </form>
      </main>
    );
  }

  if (step === 'code') {
    return (
      <main className="mx-4 mt-16 max-w-md rounded-card border border-char/10 bg-white px-8 py-10 shadow-sm sm:mx-auto">
        <h1 className="font-heading mb-1 text-2xl font-bold text-char">
          {t('auth.code.title')}
        </h1>
        <p className="mb-6 text-sm text-char/60">
          <Trans
            i18nKey="auth.code.description"
            values={{ email: email || t('auth.code.inboxFallback') }}
            components={{ strong: <strong /> }}
          />
        </p>
        <form onSubmit={submitCode} className="space-y-5">
          <NonFieldErrors errors={errors} />
          <div>
            <label htmlFor="code" className={labelClass}>
              {t('auth.code.codeLabel')}
            </label>
            <input
              id="code"
              type="text"
              inputMode="text"
              autoComplete="one-time-code"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="XXXX-XXXX"
              required
              className={`${inputClass} text-center tracking-widest`}
            />
            <FieldErrors param="code" errors={errors} />
          </div>
          <button type="submit" disabled={loading} className={primaryBtn}>
            {loading
              ? `${t('common.signingIn')}…`
              : t('auth.code.submit.default')}
          </button>
          <button
            type="button"
            onClick={() => {
              setStep('email');
              setCode('');
              setErrors([]);
            }}
            className="w-full text-sm text-char/50 hover:text-char"
          >
            ← {t('auth.code.differentEmail')}
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="mx-4 mt-16 max-w-md rounded-card border border-char/10 bg-white px-8 py-10 shadow-sm sm:mx-auto">
      <h1 className="font-heading mb-2 text-2xl font-bold text-char">
        {t('auth.email.title')}
      </h1>
      <p className="mb-6 text-sm text-char/60">{t('auth.email.description')}</p>
      <form onSubmit={sendCode} className="space-y-5">
        <NonFieldErrors errors={errors} />
        <div>
          <label htmlFor="email" className={labelClass}>
            {t('auth.email.emailLabel')}
          </label>
          <input
            id="email"
            type="email"
            autoComplete="username webauthn"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className={inputClass}
          />
          <FieldErrors param="email" errors={errors} />
        </div>
        <button type="submit" disabled={loading} className={primaryBtn}>
          {loading
            ? `${t('auth.email.submit.loading')}…`
            : t('auth.email.submit.default')}
        </button>
      </form>
      {browserSupportsWebAuthn() && (
        <>
          <div className="relative my-5">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-char/10" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-white px-2 text-char/40">
                {t('common.or')}
              </span>
            </div>
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={() => void signInWithPasskey()}
            className={primaryBtn}
          >
            {loading
              ? `${t('common.signingIn')}…`
              : t('auth.email.passkey.default')}
          </button>
        </>
      )}
      <SocialProviders callbackUrl="/accounts/login/" />
    </main>
  );
}
