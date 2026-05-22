import { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import {
  getEmailAddresses,
  addEmail,
  deleteEmail,
  markEmailAsPrimary,
  requestEmailVerification,
  type EmailAddress,
  type AllauthError,
} from '../../lib/allauthApi';
import {
  inputClass,
  labelClass,
  outlineBtnMd,
  outlineBtnSm,
  primaryBtnMd,
} from '../../styles';

export default function EmailSection() {
  const { t } = useTranslation();
  const [addresses, setAddresses] = useState<EmailAddress[]>([]);
  const [newEmail, setNewEmail] = useState('');
  const [errors, setErrors] = useState<AllauthError[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  function reload() {
    return getEmailAddresses().then((resp) => {
      if (resp.status === 200 && Array.isArray(resp.data)) {
        setAddresses(resp.data as EmailAddress[]);
      }
      setLoading(false);
    });
  }

  useEffect(() => {
    reload();
  }, []);

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setErrors([]);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }

  async function handleChange(e: React.FormEvent) {
    e.preventDefault();
    await act(async () => {
      const resp = await addEmail(newEmail);
      if (resp.status === 200 && Array.isArray(resp.data)) {
        setAddresses(resp.data as EmailAddress[]);
        setNewEmail('');
      } else {
        setErrors(
          resp.errors ?? [
            { message: t('settings.email.errors.failedRequest') },
          ],
        );
      }
    });
  }

  async function handleResend(email: string) {
    await act(async () => {
      const resp = await requestEmailVerification(email);
      if (resp.status !== 200) {
        setErrors(
          resp.errors ?? [
            { message: t('settings.email.errors.failedVerification') },
          ],
        );
      }
    });
  }

  async function handleConfirm(newAddr: EmailAddress, oldEmail: string) {
    await act(async () => {
      const r1 = await markEmailAsPrimary(newAddr.email);
      if (r1.status !== 200) {
        setErrors(
          r1.errors ?? [{ message: t('settings.email.errors.failedPrimary') }],
        );
        return;
      }
      const r2 = await deleteEmail(oldEmail);
      if (r2.status === 200 && Array.isArray(r2.data)) {
        setAddresses(r2.data as EmailAddress[]);
      } else {
        setErrors(
          r2.errors ?? [{ message: t('settings.email.errors.failedRemove') }],
        );
        await reload();
      }
    });
  }

  async function handleCancel(email: string) {
    await act(async () => {
      const resp = await deleteEmail(email);
      if (resp.status === 200 && Array.isArray(resp.data)) {
        setAddresses(resp.data as EmailAddress[]);
      } else {
        setErrors(
          resp.errors ?? [{ message: t('settings.email.errors.failedCancel') }],
        );
      }
    });
  }

  if (loading)
    return <p className="text-sm text-char/50">{t('common.loading')}…</p>;

  const primary = addresses.find((a) => a.primary);
  const pending = addresses.find((a) => !a.primary && !a.verified);
  const readyToSwitch = addresses.find((a) => !a.primary && a.verified);

  return (
    <div className="space-y-4">
      {errors.length > 0 && (
        <p className="text-sm text-ember">
          {errors.map((e) => e.message).join(' ')}
        </p>
      )}

      {primary && (
        <div>
          <p className="mb-1 text-sm font-medium text-char/70">
            {t('settings.email.currentEmail')}
          </p>
          <p className="text-sm text-char">{primary.email}</p>
        </div>
      )}

      {readyToSwitch && primary && (
        <div className="rounded-card border border-amber/30 bg-amber/5 p-4 space-y-3">
          <p className="text-sm text-char">
            <Trans
              i18nKey="settings.email.readyToSwitch"
              values={{ email: readyToSwitch.email }}
              components={{ strong: <strong /> }}
            />
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => handleConfirm(readyToSwitch, primary.email)}
              disabled={busy}
              className={primaryBtnMd}
            >
              {busy
                ? `${t('common.confirming')}…`
                : t('settings.email.confirmChange.default')}
            </button>
            <button
              onClick={() => handleCancel(readyToSwitch.email)}
              disabled={busy}
              className={`${outlineBtnMd} disabled:opacity-50`}
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      {pending && (
        <div className="rounded-card border border-char/15 bg-linen/50 p-4 space-y-3">
          <p className="text-sm text-char">
            <Trans
              i18nKey="settings.email.pendingVerify"
              values={{ email: pending.email }}
              components={{ strong: <strong /> }}
            />
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => handleResend(pending.email)}
              disabled={busy}
              className={`${outlineBtnSm} disabled:opacity-50`}
            >
              {busy
                ? `${t('common.sending')}…`
                : t('settings.email.resendEmail.default')}
            </button>
            <button
              onClick={() => handleCancel(pending.email)}
              disabled={busy}
              className="text-sm text-char/50 hover:text-char disabled:opacity-50"
            >
              {t('settings.email.cancelChange')}
            </button>
          </div>
        </div>
      )}

      {!pending && !readyToSwitch && (
        <form onSubmit={handleChange} className="space-y-3">
          <div>
            <label htmlFor="new-email" className={labelClass}>
              {t('settings.email.newEmailLabel')}
            </label>
            <input
              id="new-email"
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder={t('settings.email.newEmailPlaceholder')}
              required
              className={inputClass}
            />
          </div>
          <button type="submit" disabled={busy} className={primaryBtnMd}>
            {busy
              ? `${t('settings.email.changeEmail.loading')}…`
              : t('settings.email.changeEmail.default')}
          </button>
        </form>
      )}
    </div>
  );
}
