import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { inputClass, labelClass, outlineBtnMd, primaryBtnMd } from '../styles';
import type { ReauthControls } from '../lib/useReauthentication';

interface Props {
  controls: ReauthControls;
  busy: boolean;
  tPrefix: 'settings.mfa.reauth' | 'settings.passkeys.reauth';
  errorBanner?: ReactNode;
}

export function ReauthForm({ controls, busy, tPrefix, errorBanner }: Props) {
  const { t } = useTranslation();
  const { state, cancel, sendCode, submitWithCode, submitWithPassword } =
    controls;

  return (
    <div className="space-y-4">
      {errorBanner}
      <p className="text-sm text-char/70">{t(`${tPrefix}.description`)}</p>
      {state.hasPassword ? (
        <form onSubmit={submitWithPassword} className="space-y-3">
          <div>
            <label htmlFor="reauth-password" className={labelClass}>
              {t('common.password')}
            </label>
            <input
              id="reauth-password"
              type="password"
              autoComplete="current-password"
              value={state.password}
              onChange={(e) => state.setPassword(e.target.value)}
              required
              className={inputClass}
            />
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className={primaryBtnMd}>
              {busy ? `${t('common.confirming')}…` : t('common.confirm')}
            </button>
            <button type="button" onClick={cancel} className={outlineBtnMd}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      ) : !state.codeSent ? (
        <div className="space-y-3">
          <button
            type="button"
            onClick={sendCode}
            disabled={busy}
            className={primaryBtnMd}
          >
            {busy
              ? `${t('common.sending')}…`
              : t(`${tPrefix}.sendCode.default`, { email: state.email })}
          </button>
          <button
            type="button"
            onClick={cancel}
            className="block text-sm text-char/50 hover:text-char"
          >
            {t('common.cancel')}
          </button>
        </div>
      ) : (
        <form onSubmit={submitWithCode} className="space-y-3">
          <p className="text-sm text-char/70">
            {t(`${tPrefix}.codeSent`, { email: state.email })}
          </p>
          <div>
            <label htmlFor="reauth-code" className={labelClass}>
              {t('common.verificationCodeLabel')}
            </label>
            <input
              id="reauth-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={state.code}
              onChange={(e) => state.setCode(e.target.value)}
              placeholder="123456"
              required
              className={`${inputClass} text-center tracking-widest`}
            />
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className={primaryBtnMd}>
              {busy ? `${t('common.confirming')}…` : t('common.confirm')}
            </button>
            <button type="button" onClick={cancel} className={outlineBtnMd}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
