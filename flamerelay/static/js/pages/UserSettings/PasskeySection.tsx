import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  startRegistration,
  browserSupportsWebAuthn,
  type PublicKeyCredentialCreationOptionsJSON,
} from '@simplewebauthn/browser';
import {
  getPasskeys,
  beginPasskeyRegistration,
  completePasskeyRegistration,
  deletePasskey,
  type AllauthError,
  type WebAuthnPasskey,
} from '../../lib/allauthApi';
import {
  needsReauth,
  useReauthentication,
} from '../../lib/useReauthentication';
import { NonFieldErrors } from '../../components/AllauthErrors';
import { ReauthForm } from '../../components/ReauthForm';
import {
  inputClass,
  labelClass,
  outlineBtnMd,
  outlineBtnSm,
  primaryBtnMd,
} from '../../styles';

type PasskeyView = 'list' | 'adding';

export default function PasskeySection() {
  const { t } = useTranslation();
  const [view, setView] = useState<PasskeyView>('list');
  const [passkeys, setPasskeys] = useState<WebAuthnPasskey[]>([]);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<AllauthError[]>([]);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  const reauth = useReauthentication({
    setErrors,
    setBusy,
    onSuccess: () => setView('adding'),
    onCancel: () => setView('list'),
  });

  const supported = browserSupportsWebAuthn();

  function loadPasskeys() {
    return getPasskeys().then((resp) => {
      if (resp.status === 200 && Array.isArray(resp.data)) {
        const all = resp.data as unknown as Array<
          { type: string } & WebAuthnPasskey
        >;
        setPasskeys(all.filter((a) => a.type === 'webauthn'));
      } else {
        setPasskeys([]);
      }
      setLoading(false);
    });
  }

  useEffect(() => {
    loadPasskeys();
  }, []);

  async function addPasskey(e: React.FormEvent) {
    e.preventDefault();
    setErrors([]);
    setBusy(true);
    try {
      const resp = await beginPasskeyRegistration();
      if (needsReauth(resp)) {
        reauth.fromResponse(resp);
        return;
      }
      if (resp.status !== 200 && resp.status !== 201) {
        setErrors(
          resp.errors ?? [
            { message: t('settings.passkeys.errors.startFailed') },
          ],
        );
        return;
      }
      const options = (
        resp as unknown as {
          data: {
            creation_options: {
              publicKey: PublicKeyCredentialCreationOptionsJSON;
            };
          };
        }
      ).data.creation_options.publicKey;
      const credential = await startRegistration({ optionsJSON: options });
      const completeResp = await completePasskeyRegistration(
        credential,
        newName.trim() || 'My passkey',
      );
      if (completeResp.status === 200 || completeResp.status === 201) {
        setNewName('');
        setView('list');
        loadPasskeys();
      } else {
        setErrors(
          completeResp.errors ?? [
            { message: t('settings.passkeys.errors.registerFailed') },
          ],
        );
      }
    } catch {
      setErrors([{ message: t('settings.passkeys.errors.cancelled') }]);
    } finally {
      setBusy(false);
    }
  }

  async function removePasskey(id: number) {
    setErrors([]);
    setBusy(true);
    try {
      const resp = await deletePasskey(id);
      if (resp.status === 200 || resp.status === 204) {
        loadPasskeys();
      } else {
        setErrors(
          resp.errors ?? [
            { message: t('settings.passkeys.errors.removeFailed') },
          ],
        );
      }
    } finally {
      setBusy(false);
    }
  }

  if (!supported) {
    return (
      <p className="text-sm text-char/60">
        {t('settings.passkeys.unsupported')}
      </p>
    );
  }

  if (loading) {
    return <p className="text-sm text-char/50">{t('common.loading')}…</p>;
  }

  if (reauth.state.active) {
    return (
      <ReauthForm
        controls={reauth}
        busy={busy}
        tPrefix="settings.passkeys.reauth"
        errorBanner={<NonFieldErrors errors={errors} />}
      />
    );
  }

  if (view === 'adding') {
    return (
      <form onSubmit={addPasskey} className="space-y-4">
        <NonFieldErrors errors={errors} />
        <div>
          <label htmlFor="passkey-name" className={labelClass}>
            {t('settings.passkeys.adding.nameLabel')}
          </label>
          <input
            id="passkey-name"
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t('settings.passkeys.adding.namePlaceholder')}
            className={inputClass}
            autoFocus
          />
          <p className="mt-1 text-xs text-char/50">
            {t('settings.passkeys.adding.nameHint')}
          </p>
        </div>
        <div className="flex gap-3">
          <button type="submit" disabled={busy} className={primaryBtnMd}>
            {busy
              ? `${t('settings.passkeys.adding.submit.loading')}…`
              : t('settings.passkeys.adding.submit.default')}
          </button>
          <button
            type="button"
            onClick={() => {
              setView('list');
              setErrors([]);
              setNewName('');
            }}
            className={outlineBtnMd}
          >
            {t('common.cancel')}
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-char/60">
        {t('settings.passkeys.description')}
      </p>
      <NonFieldErrors errors={errors} />
      {passkeys.length === 0 ? (
        <p className="text-sm text-char/60">
          {t('settings.passkeys.noPasskeys')}
        </p>
      ) : (
        <ul className="divide-y divide-char/10">
          {passkeys.map((pk) => (
            <li key={pk.id} className="flex items-center justify-between py-3">
              <div>
                <p className="text-sm font-medium text-char">{pk.name}</p>
                <p className="text-xs text-char/50">
                  {t('settings.passkeys.added', {
                    date: new Date(pk.created_at * 1000).toLocaleDateString(),
                  })}
                  {pk.last_used_at &&
                    ` · ${t('settings.passkeys.lastUsed', { date: new Date(pk.last_used_at * 1000).toLocaleDateString() })}`}
                </p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => removePasskey(pk.id)}
                className={`${outlineBtnSm} text-ember hover:text-ember`}
              >
                {t('common.remove')}
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={() => {
          setErrors([]);
          setView('adding');
        }}
        className={primaryBtnMd}
      >
        {t('settings.passkeys.addBtn')}
      </button>
    </div>
  );
}
