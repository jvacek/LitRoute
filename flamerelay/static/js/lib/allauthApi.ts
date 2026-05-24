import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/browser';
import { getCsrfToken } from '../api';

const BASE = '/_allauth/browser/v1';

export interface AllauthError {
  param?: string;
  message: string;
  code?: string;
}

export interface AllauthFlow {
  id: string;
  is_pending?: boolean;
}

export interface AllauthResponse {
  status: number;
  data?:
    | {
        flows?: AllauthFlow[];
        user?: Record<string, unknown>;
        email?: string;
      }
    | unknown[];
  errors?: AllauthError[];
  meta?: {
    is_authenticated?: boolean;
    [key: string]: unknown;
  };
}

async function allauthFetch(
  method: string,
  path: string,
  body?: Record<string, unknown>,
  extraHeaders?: Record<string, string>,
): Promise<AllauthResponse> {
  const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(
    method.toUpperCase(),
  );
  const res = await fetch(BASE + path, {
    method,
    headers: {
      Accept: 'application/json',
      ...(mutating ? { 'X-CSRFToken': getCsrfToken() } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...extraHeaders,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json() as Promise<AllauthResponse>;
}

export function hasPendingFlow(resp: AllauthResponse, flowId: string): boolean {
  if (!resp.data || Array.isArray(resp.data)) return false;
  return (
    resp.data.flows?.some((f) => f.id === flowId && f.is_pending === true) ??
    false
  );
}

export async function getSession(): Promise<AllauthResponse> {
  return allauthFetch('GET', '/auth/session');
}

export interface CodeRequestResult {
  ok: boolean;
  detail?: string;
}

// Calls our own endpoint (not /_allauth/), so returns CodeRequestResult instead of AllauthResponse.
// `turnstileToken` is empty for authenticated callers (reauthentication
// flow); the server only checks the token when the request is anonymous.
export async function requestLoginCode(
  email: string,
  turnstileToken?: string,
): Promise<CodeRequestResult> {
  const resp = await fetch('/api/auth/code/request/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRFToken': getCsrfToken(),
    },
    body: JSON.stringify({ email, turnstile_token: turnstileToken ?? '' }),
  });
  const data = (await resp.json()) as { detail?: string };
  return { ok: resp.ok, detail: data.detail };
}

export async function confirmLoginCode(code: string): Promise<AllauthResponse> {
  return allauthFetch('POST', '/auth/code/confirm', { code });
}

export async function mfaAuthenticate(code: string): Promise<AllauthResponse> {
  return allauthFetch('POST', '/auth/2fa/authenticate', { code });
}

export async function logout(): Promise<AllauthResponse> {
  return allauthFetch('DELETE', '/auth/session');
}

// Email verification
export async function getEmailVerification(
  key: string,
): Promise<AllauthResponse> {
  return allauthFetch('GET', '/auth/email/verify', undefined, {
    'X-Email-Verification-Key': key,
  });
}

export async function verifyEmail(key: string): Promise<AllauthResponse> {
  return allauthFetch('POST', '/auth/email/verify', { key });
}

// Email address management
export interface EmailAddress {
  email: string;
  primary: boolean;
  verified: boolean;
}

export async function getEmailAddresses(): Promise<AllauthResponse> {
  return allauthFetch('GET', '/account/email');
}

export async function addEmail(email: string): Promise<AllauthResponse> {
  return allauthFetch('POST', '/account/email', { email });
}

export async function deleteEmail(email: string): Promise<AllauthResponse> {
  return allauthFetch('DELETE', '/account/email', { email });
}

export async function markEmailAsPrimary(
  email: string,
): Promise<AllauthResponse> {
  return allauthFetch('PATCH', '/account/email', { email, primary: true });
}

export async function requestEmailVerification(
  email: string,
): Promise<AllauthResponse> {
  return allauthFetch('PUT', '/account/email', { email });
}

// ---------------------------------------------------------------------------
// MFA / Authenticators
// ---------------------------------------------------------------------------

export type AuthenticatorType = 'totp' | 'recovery_codes' | 'webauthn';

export interface TotpAuthenticator {
  type: 'totp';
  created_at: number;
  last_used_at: number | null;
}

export interface RecoveryCodesAuthenticator {
  type: 'recovery_codes';
  created_at: number;
  total_code_count: number;
  unused_code_count: number;
}

export type Authenticator = TotpAuthenticator | RecoveryCodesAuthenticator;

export interface TotpSetupMeta {
  secret: string;
  totp_url: string;
}

export async function getAuthenticators(): Promise<AllauthResponse> {
  return allauthFetch('GET', '/account/authenticators');
}

export async function getTotpSetup(): Promise<AllauthResponse> {
  return allauthFetch('GET', '/account/authenticators/totp');
}

export async function activateTotp(code: string): Promise<AllauthResponse> {
  return allauthFetch('POST', '/account/authenticators/totp', { code });
}

export async function deactivateTotp(code: string): Promise<AllauthResponse> {
  return allauthFetch('DELETE', '/account/authenticators/totp', { code });
}

export async function getRecoveryCodes(): Promise<AllauthResponse> {
  return allauthFetch('GET', '/account/authenticators/recovery-codes');
}

export async function generateRecoveryCodes(): Promise<AllauthResponse> {
  return allauthFetch('POST', '/account/authenticators/recovery-codes');
}

// ---------------------------------------------------------------------------
// WebAuthn / Passkeys
// ---------------------------------------------------------------------------

export interface WebAuthnPasskey {
  id: number;
  created_at: number;
  last_used_at: number | null;
  name: string;
}

export async function getPasskeyLoginOptions(): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const resp = await allauthFetch('GET', '/auth/webauthn/login');
  return (
    resp as unknown as {
      data: {
        request_options: { publicKey: PublicKeyCredentialRequestOptionsJSON };
      };
    }
  ).data.request_options.publicKey;
}

export async function passkeyLogin(
  credential: AuthenticationResponseJSON,
): Promise<AllauthResponse> {
  return allauthFetch('POST', '/auth/webauthn/login', {
    credential: credential as unknown as Record<string, unknown>,
  });
}

// Path is /auth/webauthn/authenticate, not /auth/2fa/webauthn/authenticate
export async function getWebAuthnMfaOptions(): Promise<AllauthResponse> {
  return allauthFetch('GET', '/auth/webauthn/authenticate');
}

export async function submitWebAuthnMfa(
  credential: AuthenticationResponseJSON,
): Promise<AllauthResponse> {
  return allauthFetch('POST', '/auth/webauthn/authenticate', {
    credential: credential as unknown as Record<string, unknown>,
  });
}

// Returns all authenticators; caller filters by type === 'webauthn'
export async function getPasskeys(): Promise<AllauthResponse> {
  return allauthFetch('GET', '/account/authenticators');
}

// GET begins registration (returns creation_options challenge)
export async function beginPasskeyRegistration(): Promise<AllauthResponse> {
  return allauthFetch('GET', '/account/authenticators/webauthn');
}

// POST completes registration
export async function completePasskeyRegistration(
  credential: RegistrationResponseJSON,
  name: string,
): Promise<AllauthResponse> {
  return allauthFetch('POST', '/account/authenticators/webauthn', {
    credential: credential as unknown as Record<string, unknown>,
    name,
  });
}

export async function deletePasskey(id: number): Promise<AllauthResponse> {
  return allauthFetch('DELETE', '/account/authenticators/webauthn', {
    authenticators: [id],
  });
}

export async function reauthenticateWithCode(
  code: string,
): Promise<AllauthResponse> {
  return allauthFetch('POST', '/auth/reauthenticate', { code });
}

export async function reauthenticateWithPassword(
  password: string,
): Promise<AllauthResponse> {
  return allauthFetch('POST', '/auth/reauthenticate', { password });
}

export interface SocialProvider {
  id: string;
  name: string;
  flows: string[];
}

export interface ConnectedAccount {
  uid: string;
  provider: SocialProvider;
  display: string;
}

export async function getConnectedAccounts(): Promise<AllauthResponse> {
  return allauthFetch('GET', '/account/providers');
}

export async function disconnectAccount(
  providerId: string,
  uid: string,
): Promise<AllauthResponse> {
  return allauthFetch('DELETE', '/account/providers', {
    provider: providerId,
    account: uid,
  });
}

export interface AllauthConfig {
  account: Record<string, unknown>;
  socialaccount?: { providers: SocialProvider[] };
}

export async function getConfig(): Promise<AllauthConfig> {
  const resp = await fetch(BASE + '/config', {
    headers: { Accept: 'application/json' },
  });
  const json = (await resp.json()) as { status: number; data: AllauthConfig };
  return json.data;
}

export function redirectToProvider(
  providerId: string,
  callbackUrl: string,
  process: 'login' | 'connect' = 'login',
): void {
  if (!callbackUrl.startsWith('/') || callbackUrl.startsWith('//')) {
    throw new Error(`callbackUrl must be a relative path, got: ${callbackUrl}`);
  }
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = BASE + '/auth/provider/redirect';
  const fields: Record<string, string> = {
    provider: providerId,
    process,
    callback_url: window.location.origin + callbackUrl,
    csrfmiddlewaretoken: getCsrfToken(),
  };
  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}
