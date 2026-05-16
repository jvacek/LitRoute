import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { useTranslation } from 'react-i18next';
import {
  getAuthenticators,
  getSession,
  getTotpSetup,
  activateTotp,
  deactivateTotp,
  getRecoveryCodes,
  generateRecoveryCodes,
  type AllauthError,
  type Authenticator,
  type TotpAuthenticator,
  type RecoveryCodesAuthenticator,
  type TotpSetupMeta,
} from '../../lib/allauthApi';
import {
  needsReauth,
  useReauthentication,
} from '../../lib/useReauthentication';
import { ReauthForm } from '../../components/ReauthForm';
import { inputClass, labelClass } from '../../styles';

function TotpQrCode({ url }: { url: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current) {
      void QRCode.toCanvas(canvasRef.current, url, { width: 200, margin: 1 });
    }
  }, [url]);

  return <canvas ref={canvasRef} className="rounded-lg" />;
}

type MfaView =
  | 'overview'
  | 'totp-setup'
  | 'totp-deactivate'
  | 'recovery-codes'
  | 'recovery-codes-generate';

export default function MfaSection() {
  const { t } = useTranslation();
  const [view, setView] = useState<MfaView>('overview');
  const [totp, setTotp] = useState<TotpAuthenticator | null>(null);
  const [recoveryCodes, setRecoveryCodes] =
    useState<RecoveryCodesAuthenticator | null>(null);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<AllauthError[]>([]);

  const [totpMeta, setTotpMeta] = useState<TotpSetupMeta | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [busy, setBusy] = useState(false);

  const [codes, setCodes] = useState<string[]>([]);

  const [pendingView, setPendingView] = useState<
    'totp-setup' | 'totp-deactivate' | null
  >(null);

  const reauth = useReauthentication({
    setErrors,
    setBusy,
    onSuccess: () => setView(pendingView ?? 'overview'),
    onCancel: () => setView('overview'),
  });

  function loadAuthenticators() {
    return getAuthenticators().then((resp) => {
      if (resp.status === 200 && Array.isArray(resp.data)) {
        const list = resp.data as Authenticator[];
        setTotp(
          (list.find((a) => a.type === 'totp') as TotpAuthenticator) ?? null,
        );
        setRecoveryCodes(
          (list.find(
            (a) => a.type === 'recovery_codes',
          ) as RecoveryCodesAuthenticator) ?? null,
        );
      }
      setLoading(false);
    });
  }

  useEffect(() => {
    loadAuthenticators();
  }, []);

  async function startTotpSetup() {
    setErrors([]);
    setBusy(true);
    try {
      const [totpResp, sessionResp] = await Promise.all([
        getTotpSetup(),
        getSession(),
      ]);

      // 404 = "TOTP not yet active"; allauth returns setup data in meta.
      // Double-cast needed: AllauthResponse.meta uses an index signature so
      // TypeScript can't verify TotpSetupMeta's required string fields.
      if (totpResp.status !== 404 || !totpResp.meta) return;

      setTotpMeta(totpResp.meta as unknown as TotpSetupMeta);
      setTotpCode('');

      // Detect upfront whether reauthentication will be required so the user
      // only has to enter the TOTP code once. Allauth requires reauth when the
      // user has a usable password and authenticated more than 300 s ago.
      if (
        sessionResp.status === 200 &&
        sessionResp.data &&
        !Array.isArray(sessionResp.data)
      ) {
        type SessionData = {
          user?: { email?: string; has_usable_password?: boolean };
          methods?: Array<{ at?: number }>;
        };
        const sd = sessionResp.data as unknown as SessionData;
        const hasPassword = sd.user?.has_usable_password === true;
        const methods = sd.methods ?? [];
        const lastAt = methods[methods.length - 1]?.at ?? 0;
        const stale = Date.now() / 1000 - lastAt > 300;

        if (hasPassword && stale) {
          setPendingView('totp-setup');
          reauth.activate({ email: sd.user?.email ?? '', hasPassword: true });
          return;
        }
      }

      setView('totp-setup');
    } finally {
      setBusy(false);
    }
  }

  async function handleActivateTotp(e: React.FormEvent) {
    e.preventDefault();
    setErrors([]);
    setBusy(true);
    try {
      const resp = await activateTotp(totpCode);
      if (resp.status === 200) {
        setTotpCode('');
        setView('overview');
        await loadAuthenticators();
      } else if (needsReauth(resp)) {
        setPendingView('totp-setup');
        reauth.fromResponse(resp);
      } else {
        setErrors(
          resp.errors ?? [{ message: t('settings.mfa.setup.invalidCode') }],
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleDeactivateTotp(e: React.FormEvent) {
    e.preventDefault();
    setErrors([]);
    setBusy(true);
    try {
      const resp = await deactivateTotp(totpCode);
      if (resp.status === 200) {
        setTotpCode('');
        setView('overview');
        await loadAuthenticators();
      } else if (needsReauth(resp)) {
        setPendingView('totp-deactivate');
        reauth.fromResponse(resp);
      } else {
        setErrors(
          resp.errors ?? [{ message: t('settings.mfa.setup.invalidCode') }],
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function openRecoveryCodes() {
    setErrors([]);
    setBusy(true);
    try {
      const resp = await getRecoveryCodes();
      if (resp.status === 200 && resp.data && !Array.isArray(resp.data)) {
        const data = resp.data as unknown as { unused_codes: string[] };
        setCodes(data.unused_codes ?? []);
        setView('recovery-codes');
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleGenerateCodes() {
    setErrors([]);
    setBusy(true);
    try {
      const resp = await generateRecoveryCodes();
      if (resp.status === 200 && resp.data && !Array.isArray(resp.data)) {
        const data = resp.data as unknown as { unused_codes: string[] };
        setCodes(data.unused_codes ?? []);
        await loadAuthenticators();
        setView('recovery-codes');
      } else {
        setErrors(
          resp.errors ?? [
            { message: t('settings.mfa.recoveryCodes.failedGenerate') },
          ],
        );
      }
    } finally {
      setBusy(false);
    }
  }

  if (loading)
    return <p className="text-sm text-char/50">{t('common.loading')}…</p>;

  const errorBanner = errors.length > 0 && (
    <p className="text-sm text-ember">
      {errors.map((e) => e.message).join(' ')}
    </p>
  );

  if (reauth.state.active) {
    return (
      <ReauthForm
        controls={reauth}
        busy={busy}
        tPrefix="settings.mfa.reauth"
        errorBanner={errorBanner}
      />
    );
  }

  if (view === 'totp-setup' && totpMeta) {
    return (
      <div className="space-y-4">
        {errorBanner}
        <p className="text-sm text-char/70">
          {t('settings.mfa.setup.description')}
        </p>
        <div className="flex justify-center">
          <TotpQrCode url={totpMeta.totp_url} />
        </div>
        <div className="rounded-card border border-char/15 bg-linen/50 p-4">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-char/50">
            {t('settings.mfa.setup.secretKeyLabel')}
          </p>
          <kbd className="font-mono text-sm text-char break-all">
            {totpMeta.secret}
          </kbd>
        </div>
        <form onSubmit={handleActivateTotp} className="space-y-3">
          <div>
            <label htmlFor="totp-code" className={labelClass}>
              {t('common.verificationCodeLabel')}
            </label>
            <input
              id="totp-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value)}
              placeholder="123456"
              required
              className={`${inputClass} text-center tracking-widest`}
            />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded-btn bg-amber px-[18px] py-[7px] text-sm font-semibold tracking-wide text-white transition-transform hover:-translate-y-px active:translate-y-0 disabled:pointer-events-none disabled:opacity-50"
            >
              {busy
                ? `${t('settings.mfa.setup.activate.loading')}…`
                : t('settings.mfa.setup.activate.default')}
            </button>
            <button
              type="button"
              onClick={() => {
                setView('overview');
                setErrors([]);
              }}
              className="rounded-btn border border-char/15 px-[18px] py-[7px] text-sm font-medium text-char transition-colors hover:bg-linen"
            >
              {t('common.cancel')}
            </button>
          </div>
        </form>
      </div>
    );
  }

  if (view === 'totp-deactivate') {
    return (
      <div className="space-y-4">
        {errorBanner}
        <p className="text-sm text-char/70">
          {t('settings.mfa.deactivate.description')}
        </p>
        <form onSubmit={handleDeactivateTotp} className="space-y-3">
          <div>
            <label htmlFor="totp-deactivate-code" className={labelClass}>
              {t('common.verificationCodeLabel')}
            </label>
            <input
              id="totp-deactivate-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value)}
              placeholder="123456"
              required
              className={`${inputClass} text-center tracking-widest`}
            />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded-btn bg-ember px-[18px] py-[7px] text-sm font-semibold tracking-wide text-white transition-transform hover:-translate-y-px active:translate-y-0 disabled:pointer-events-none disabled:opacity-50"
            >
              {busy
                ? `${t('settings.mfa.deactivate.remove.loading')}…`
                : t('settings.mfa.deactivate.remove.default')}
            </button>
            <button
              type="button"
              onClick={() => {
                setView('overview');
                setErrors([]);
                setTotpCode('');
              }}
              className="rounded-btn border border-char/15 px-[18px] py-[7px] text-sm font-medium text-char transition-colors hover:bg-linen"
            >
              {t('common.cancel')}
            </button>
          </div>
        </form>
      </div>
    );
  }

  if (view === 'recovery-codes') {
    return (
      <div className="space-y-4">
        {errorBanner}
        <p className="text-sm text-char/70">
          {t('settings.mfa.recoveryCodes.eachOnce')}
        </p>
        <div className="grid grid-cols-2 gap-2 rounded-lg border border-char/15 bg-linen/50 p-4">
          {codes.map((c) => (
            <kbd key={c} className="font-mono text-sm text-char">
              {c}
            </kbd>
          ))}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setView('recovery-codes-generate')}
            className="rounded-btn border border-char/15 px-[18px] py-[7px] text-sm font-medium text-char transition-colors hover:bg-linen"
          >
            {t('settings.mfa.recoveryCodes.generateNew')}
          </button>
          <button
            type="button"
            onClick={() => setView('overview')}
            className="text-sm text-char/50 hover:text-char"
          >
            &larr; {t('common.back')}
          </button>
        </div>
      </div>
    );
  }

  if (view === 'recovery-codes-generate') {
    return (
      <div className="space-y-4">
        {errorBanner}
        <div className="rounded-card border border-ember/20 bg-ember/5 p-4">
          <p className="text-sm text-char">
            {t('settings.mfa.recoveryCodes.generateWarning')}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleGenerateCodes}
            disabled={busy}
            className="rounded-btn bg-ember px-[18px] py-[7px] text-sm font-semibold tracking-wide text-white transition-transform hover:-translate-y-px active:translate-y-0 disabled:pointer-events-none disabled:opacity-50"
          >
            {busy
              ? `${t('settings.mfa.recoveryCodes.generating.loading')}…`
              : t('settings.mfa.recoveryCodes.generateNew')}
          </button>
          <button
            type="button"
            onClick={() => setView('recovery-codes')}
            className="rounded-btn border border-char/15 px-[18px] py-[7px] text-sm font-medium text-char transition-colors hover:bg-linen"
          >
            {t('common.cancel')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {errorBanner}

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-char">
              {t('settings.mfa.totp.label')}
            </p>
            <p className="text-xs text-char/50">
              {totp
                ? t('settings.mfa.totp.active')
                : t('settings.mfa.totp.notSetUp')}
            </p>
          </div>
          {totp ? (
            <button
              type="button"
              onClick={() => {
                setTotpCode('');
                setErrors([]);
                setView('totp-deactivate');
              }}
              className="rounded-btn border border-char/15 px-3 py-[5px] text-sm font-medium text-char transition-colors hover:bg-linen"
            >
              {t('common.remove')}
            </button>
          ) : (
            <button
              type="button"
              onClick={startTotpSetup}
              disabled={busy}
              className="rounded-btn bg-amber px-3 py-[5px] text-sm font-semibold tracking-wide text-white transition-transform hover:-translate-y-px active:translate-y-0 disabled:pointer-events-none disabled:opacity-50"
            >
              {busy
                ? `${t('common.loading')}…`
                : t('settings.mfa.totp.setUp.default')}
            </button>
          )}
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-char">
              {t('settings.mfa.recoveryCodes.label')}
            </p>
            <p className="text-xs text-char/50">
              {recoveryCodes
                ? t('settings.mfa.recoveryCodes.remaining', {
                    unused: recoveryCodes.unused_code_count,
                    total: recoveryCodes.total_code_count,
                  })
                : totp
                  ? t('settings.mfa.recoveryCodes.notGenerated')
                  : t('settings.mfa.recoveryCodes.setUpFirst')}
            </p>
          </div>
          {(recoveryCodes || totp) && (
            <button
              type="button"
              onClick={openRecoveryCodes}
              disabled={busy || !totp}
              className="rounded-btn border border-char/15 px-3 py-[5px] text-sm font-medium text-char transition-colors hover:bg-linen disabled:opacity-40"
            >
              {busy
                ? `${t('common.loading')}…`
                : recoveryCodes
                  ? t('settings.mfa.recoveryCodes.viewBtn')
                  : t('settings.mfa.recoveryCodes.generateBtn')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
