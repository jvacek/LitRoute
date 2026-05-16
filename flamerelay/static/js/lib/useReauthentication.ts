import type { Dispatch, FormEvent, SetStateAction } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  reauthenticateWithCode,
  reauthenticateWithPassword,
  requestLoginCode,
  type AllauthError,
  type AllauthResponse,
} from './allauthApi';

export function needsReauth(resp: AllauthResponse): boolean {
  if (resp.status !== 401 || !resp.data || Array.isArray(resp.data))
    return false;
  return resp.data.flows?.some((f) => f.id === 'reauthenticate') ?? false;
}

export interface UseReauthenticationOptions {
  setErrors: Dispatch<SetStateAction<AllauthError[]>>;
  setBusy: Dispatch<SetStateAction<boolean>>;
  onSuccess: () => void;
  onCancel: () => void;
}

export interface ReauthState {
  active: boolean;
  email: string;
  hasPassword: boolean;
  code: string;
  setCode: (v: string) => void;
  codeSent: boolean;
  password: string;
  setPassword: (v: string) => void;
}

export interface ReauthControls {
  state: ReauthState;
  fromResponse: (resp: AllauthResponse) => void;
  activate: (opts: { email: string; hasPassword: boolean }) => void;
  cancel: () => void;
  sendCode: () => Promise<void>;
  submitWithCode: (e: FormEvent) => Promise<void>;
  submitWithPassword: (e: FormEvent) => Promise<void>;
}

export function useReauthentication({
  setErrors,
  setBusy,
  onSuccess,
  onCancel,
}: UseReauthenticationOptions): ReauthControls {
  const { t } = useTranslation();
  const [active, setActive] = useState(false);
  const [email, setEmail] = useState('');
  const [hasPassword, setHasPassword] = useState(false);
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [password, setPassword] = useState('');

  function resetInputs() {
    setCode('');
    setCodeSent(false);
    setPassword('');
  }

  function fromResponse(resp: AllauthResponse) {
    const data = resp.data as
      | { user?: { email?: string; has_usable_password?: boolean } }
      | undefined;
    setEmail(data?.user?.email ?? '');
    setHasPassword(data?.user?.has_usable_password === true);
    resetInputs();
    setErrors([]);
    setActive(true);
  }

  function activate(opts: { email: string; hasPassword: boolean }) {
    setEmail(opts.email);
    setHasPassword(opts.hasPassword);
    resetInputs();
    setErrors([]);
    setActive(true);
  }

  function cancel() {
    setActive(false);
    setErrors([]);
    onCancel();
  }

  async function sendCode() {
    setErrors([]);
    setBusy(true);
    try {
      const result = await requestLoginCode(email);
      if (result.ok) {
        setCodeSent(true);
      } else {
        setErrors([
          { message: result.detail ?? t('settings.reauth.failedSend') },
        ]);
      }
    } finally {
      setBusy(false);
    }
  }

  async function submitWithCode(e: FormEvent) {
    e.preventDefault();
    setErrors([]);
    setBusy(true);
    try {
      const resp = await reauthenticateWithCode(code);
      if (resp.status === 200) {
        setCode('');
        setActive(false);
        onSuccess();
      } else {
        setErrors(
          resp.errors ?? [{ message: t('settings.reauth.invalidCode') }],
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function submitWithPassword(e: FormEvent) {
    e.preventDefault();
    setErrors([]);
    setBusy(true);
    try {
      const resp = await reauthenticateWithPassword(password);
      if (resp.status === 200) {
        setPassword('');
        setActive(false);
        onSuccess();
      } else {
        setErrors(
          resp.errors ?? [{ message: t('settings.reauth.incorrectPassword') }],
        );
      }
    } finally {
      setBusy(false);
    }
  }

  return {
    state: {
      active,
      email,
      hasPassword,
      code,
      setCode,
      codeSent,
      password,
      setPassword,
    },
    fromResponse,
    activate,
    cancel,
    sendCode,
    submitWithCode,
    submitWithPassword,
  };
}
