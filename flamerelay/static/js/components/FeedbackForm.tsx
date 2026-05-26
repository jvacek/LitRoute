import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../AuthContext';
import { apiFetch } from '../api';
import { useTurnstileGate } from '../lib/useTurnstileGate';
import { fieldErrorClass, inputClass, labelClass, primaryBtn } from '../styles';

const MESSAGE_MAX_LENGTH = 5000;

export default function FeedbackForm() {
  const { t } = useTranslation();
  const { isAuthenticated, name } = useAuth();
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const {
    token: turnstileToken,
    widget: turnstileWidget,
    isReady: turnstileReady,
    reset: resetTurnstile,
  } = useTurnstileGate({
    enabled: !isAuthenticated,
    onRetry: () => setError(''),
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!message.trim()) {
      setError(t('feedback.errorRequiredMessage'));
      return;
    }
    if (!turnstileReady) {
      setError(t('common.captcha.pending'));
      return;
    }
    setLoading(true);
    try {
      const res = await apiFetch('/api/feedback/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          email: isAuthenticated ? '' : email,
          turnstile_token: turnstileToken,
        }),
      });
      if (res.ok) {
        setSent(true);
      } else {
        const json = (await res.json()) as { detail?: string };
        setError(json.detail ?? t('feedback.errorGeneric'));
        // Server-side captcha rejection: remount the widget so the user
        // can submit again. Detail string is set in
        // backend/api/views/feedback.py.
        if (json.detail?.toLowerCase().includes('captcha')) {
          resetTurnstile();
        }
      }
    } catch {
      setError(t('feedback.errorGeneric'));
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div className="rounded-card bg-white px-8 py-12 text-center shadow-sm">
        <h3 className="font-heading mb-3 text-3xl font-bold text-amber">
          {t('feedback.successTitle')}
        </h3>
        <p className="text-base leading-relaxed text-char/70">
          {t('feedback.successMessage')}
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-card bg-white px-6 py-8 shadow-sm sm:px-8"
    >
      <div className="mb-5">
        <label htmlFor="feedback-message" className={labelClass}>
          {t('feedback.messageLabel')}
        </label>
        <textarea
          id="feedback-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={t('feedback.messagePlaceholder')}
          rows={6}
          maxLength={MESSAGE_MAX_LENGTH}
          required
          className={inputClass}
        />
        <p className="mt-1 text-right text-xs text-char/40">
          {message.length}/{MESSAGE_MAX_LENGTH}
        </p>
      </div>

      {isAuthenticated ? (
        <p className="mb-5 rounded-card bg-linen px-4 py-3 text-sm text-char/70">
          {t('feedback.emailHelpAuthenticated', {
            name: name || t('feedback.youFallback'),
          })}
        </p>
      ) : (
        <div className="mb-5">
          <label htmlFor="feedback-email" className={labelClass}>
            {t('feedback.emailLabel')}
          </label>
          <input
            id="feedback-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('feedback.emailPlaceholder')}
            autoComplete="email"
            inputMode="email"
            className={inputClass}
          />
          <p className="mt-1.5 text-xs text-char/50">
            {t('feedback.emailHelpAnonymous')}
          </p>
        </div>
      )}

      {turnstileWidget && <div className="mb-5">{turnstileWidget}</div>}

      <button type="submit" disabled={loading} className={primaryBtn}>
        {loading ? t('feedback.submitting') : t('feedback.submit')}
      </button>

      {error && <p className={fieldErrorClass}>{error}</p>}
    </form>
  );
}
