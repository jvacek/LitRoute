import { useState, useEffect } from 'react';
import {
  getEmailAddresses,
  addEmail,
  deleteEmail,
  markEmailAsPrimary,
  requestEmailVerification,
  type EmailAddress,
  type AllauthError,
} from '../lib/allauthApi';
import { NonFieldErrors } from './AllauthErrors';
import { inputClassFlex, secondaryBtn } from '../styles';

interface EmailAddressManagerProps {
  onUnauthorized?: () => void;
}

export default function EmailAddressManager({
  onUnauthorized,
}: EmailAddressManagerProps) {
  const [addresses, setAddresses] = useState<EmailAddress[]>([]);
  const [newEmail, setNewEmail] = useState('');
  const [errors, setErrors] = useState<AllauthError[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    getEmailAddresses().then((resp) => {
      if (resp.status === 200 && Array.isArray(resp.data)) {
        setAddresses(resp.data as EmailAddress[]);
      } else if (resp.status === 401) {
        onUnauthorized?.();
      }
      setLoading(false);
    });
  }, [onUnauthorized]);

  async function withAction(key: string, fn: () => Promise<void>) {
    setActionLoading(key);
    setErrors([]);
    try {
      await fn();
    } finally {
      setActionLoading(null);
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    await withAction('add', async () => {
      const resp = await addEmail(newEmail);
      if (resp.status === 200 && Array.isArray(resp.data)) {
        setAddresses(resp.data as EmailAddress[]);
        setNewEmail('');
      } else {
        setErrors(resp.errors ?? [{ message: 'Failed to add email.' }]);
      }
    });
  }

  async function handleDelete(email: string) {
    await withAction(`delete-${email}`, async () => {
      const resp = await deleteEmail(email);
      if (resp.status === 200 && Array.isArray(resp.data)) {
        setAddresses(resp.data as EmailAddress[]);
      } else {
        setErrors(resp.errors ?? [{ message: 'Failed to remove email.' }]);
      }
    });
  }

  async function handleMakePrimary(email: string) {
    await withAction(`primary-${email}`, async () => {
      const resp = await markEmailAsPrimary(email);
      if (resp.status === 200 && Array.isArray(resp.data)) {
        setAddresses(resp.data as EmailAddress[]);
      } else {
        setErrors(
          resp.errors ?? [{ message: 'Failed to update primary email.' }],
        );
      }
    });
  }

  async function handleResend(email: string) {
    await withAction(`resend-${email}`, async () => {
      const resp = await requestEmailVerification(email);
      if (resp.status !== 200) {
        setErrors(
          resp.errors ?? [{ message: 'Failed to send verification email.' }],
        );
      }
    });
  }

  if (loading) {
    return <p className="text-sm text-char/60">Loading&hellip;</p>;
  }

  return (
    <div className="space-y-4">
      <NonFieldErrors errors={errors} />
      <ul className="divide-y divide-char/10">
        {addresses.map((addr) => (
          <li key={addr.email} className="flex items-center gap-3 py-3">
            <div className="flex-1">
              <span className="text-sm text-char">{addr.email}</span>
              <div className="mt-0.5 flex gap-2">
                {addr.primary && (
                  <span className="rounded bg-amber/15 px-1.5 py-0.5 text-xs font-medium text-amber">
                    Primary
                  </span>
                )}
                {addr.verified ? (
                  <span className="rounded bg-char/8 px-1.5 py-0.5 text-xs text-char/50">
                    Verified
                  </span>
                ) : (
                  <span className="rounded bg-ember/10 px-1.5 py-0.5 text-xs text-ember">
                    Unverified
                  </span>
                )}
              </div>
            </div>
            <div className="flex shrink-0 gap-1">
              {!addr.primary && addr.verified && (
                <button
                  onClick={() => handleMakePrimary(addr.email)}
                  disabled={actionLoading !== null}
                  className={`${secondaryBtn} bg-char/8 text-char/70`}
                >
                  Make primary
                </button>
              )}
              {!addr.verified && (
                <button
                  onClick={() => handleResend(addr.email)}
                  disabled={actionLoading !== null}
                  className={`${secondaryBtn} bg-char/8 text-char/70`}
                >
                  {actionLoading === `resend-${addr.email}`
                    ? 'Sending\u2026'
                    : 'Resend'}
                </button>
              )}
              {!addr.primary && (
                <button
                  onClick={() => handleDelete(addr.email)}
                  disabled={actionLoading !== null}
                  className={`${secondaryBtn} bg-ember/10 text-ember`}
                >
                  Remove
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      <form onSubmit={handleAdd} className="flex gap-2">
        <input
          type="email"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          placeholder="new@example.com"
          required
          className={inputClassFlex}
        />
        <button
          type="submit"
          disabled={actionLoading !== null}
          className="rounded-btn bg-amber px-[18px] py-[9px] text-sm font-semibold tracking-wide text-white transition-transform hover:-translate-y-px active:translate-y-0 disabled:pointer-events-none disabled:opacity-50"
        >
          {actionLoading === 'add' ? 'Adding\u2026' : 'Add'}
        </button>
      </form>
    </div>
  );
}
