import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile';
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { fieldErrorClass } from '../styles';
import { useConfig } from './useConfig';

interface UseTurnstileGateOptions {
  /** When false, the gate is inert: `widget` is null, `isReady` is true,
   * `token` stays empty. Anonymous-only forms pass `!isAuthenticated`. */
  enabled?: boolean;
  /** Mirror an error surfaced by the server response (e.g. DRF's
   * `errors.captcha` field). The hook OR-merges it with its own
   * `hasError` state so the retry UI renders for both sources. */
  externalError?: boolean;
  /** Called when the user clicks "try the check again" — the caller can
   * clear whatever extra state (server error message, `externalError`
   * source) it owns before the widget remounts. */
  onRetry?: () => void;
}

interface UseTurnstileGateResult {
  /** The latest solved token. Empty until Cloudflare resolves the challenge. */
  token: string;
  /** Pre-rendered widget + failure UI. Null when the gate is disabled or no
   * site key is configured. Drop it anywhere in the form. */
  widget: ReactNode;
  /** True when the gate is disabled OR a token is held. Guards form submit. */
  isReady: boolean;
  /** Call when the server rejects with a captcha error — clears the token,
   * remounts the widget, and surfaces the retry UI. */
  reset: () => void;
  /** True when the widget is actually rendered. Useful for "if (show) include
   * turnstile_token in payload" style checks. */
  show: boolean;
}

export function useTurnstileGate({
  enabled = true,
  externalError = false,
  onRetry,
}: UseTurnstileGateOptions = {}): UseTurnstileGateResult {
  const { t } = useTranslation();
  const { turnstileSiteKey } = useConfig();
  const [token, setToken] = useState('');
  const [hasError, setHasError] = useState(false);
  const ref = useRef<TurnstileInstance | null>(null);

  const show = enabled && !!turnstileSiteKey;

  const reset = useCallback(() => {
    setToken('');
    setHasError(true);
    ref.current?.reset();
  }, []);

  const handleRetry = useCallback(() => {
    setHasError(false);
    onRetry?.();
    ref.current?.reset();
  }, [onRetry]);

  const widget = useMemo<ReactNode>(() => {
    if (!show) return null;
    const showError = hasError || externalError;
    return (
      <div className="flex flex-col items-center gap-2">
        <Turnstile
          ref={ref}
          siteKey={turnstileSiteKey}
          onSuccess={(tok) => {
            setToken(tok);
            setHasError(false);
          }}
          onError={() => {
            setToken('');
            setHasError(true);
          }}
          onExpire={() => {
            setToken('');
            ref.current?.reset();
          }}
          options={{ theme: 'light', appearance: 'interaction-only' }}
        />
        {showError && (
          <div className="flex flex-col items-center gap-1">
            <p className={fieldErrorClass}>{t('common.captcha.failed')}</p>
            <button
              type="button"
              onClick={handleRetry}
              className="text-sm text-amber underline"
            >
              {t('common.captcha.retry')}
            </button>
          </div>
        )}
      </div>
    );
  }, [show, hasError, externalError, turnstileSiteKey, t, handleRetry]);

  return {
    token,
    widget,
    isReady: !show || !!token,
    reset,
    show,
  };
}
