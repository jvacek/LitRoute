/**
 * Single-image uploader for the per-photo flow. The check-in form calls this
 * once per photo, in sequence, and shows progress like "Uploading 2/5…".
 * After all photos resolve to tokens, the form POSTs the check-in itself
 * with `pending_image_tokens: [...]`.
 *
 * Keeping this as its own module (instead of inlining into CheckinForm)
 * makes the upload contract testable in isolation and lets `CheckinEdit`
 * reuse it without duplication.
 */
import { apiFetch } from '../api';

export type PendingUploadErrorCode =
  | 'too_large' // server rejected one image at the per-file size cap
  | 'rate_limited' // per-session pending-image cap hit
  | 'captcha_required' // anon caller's first upload needs a Turnstile token
  | 'forbidden' // unit doesn't allow this caller to check in
  | 'network' // fetch threw before/while reading the response
  | 'server'; // anything else (5xx, malformed payload, etc.)

export interface PendingUploadResult {
  token: string;
  previewUrl: string;
}

export class PendingUploadError extends Error {
  readonly code: PendingUploadErrorCode;
  readonly fieldErrors?: Record<string, string[]>;
  constructor(
    code: PendingUploadErrorCode,
    message: string,
    fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'PendingUploadError';
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

interface UploadOptions {
  /** Turnstile token from the widget. Required on the first upload of an
   * anon session; subsequent calls in the same session can omit it (the
   * server caches the verification on the Django session). */
  turnstileToken?: string;
}

export async function uploadPendingImage(
  identifier: string,
  file: File,
  options: UploadOptions = {},
): Promise<PendingUploadResult> {
  const form = new FormData();
  form.append('image', file);
  if (options.turnstileToken) {
    form.append('turnstile_token', options.turnstileToken);
  }

  let res: Response;
  try {
    res = await apiFetch(`/api/units/${identifier}/pending-images/`, {
      method: 'POST',
      body: form,
    });
  } catch (err) {
    // fetch() throws TypeError on transport failures (DNS, abort, offline,
    // proxy reset). apiFetch doesn't wrap, so anything thrown here is a
    // network problem rather than a server response.
    throw new PendingUploadError(
      'network',
      err instanceof Error ? err.message : 'Network error',
    );
  }

  if (res.status === 201) {
    const json = (await res.json()) as { token: string; preview_url: string };
    return { token: json.token, previewUrl: json.preview_url };
  }

  // For known error shapes, map to a typed code so the caller can show the
  // right copy without parsing strings. Anything we can't classify falls
  // through to 'server' with the raw JSON for debugging in Sentry.
  let body: Record<string, string[]> | null = null;
  try {
    body = (await res.json()) as Record<string, string[]>;
  } catch {
    body = null;
  }

  if (res.status === 403) {
    throw new PendingUploadError(
      'forbidden',
      body?.detail?.[0] ?? 'Not allowed.',
      body ?? undefined,
    );
  }
  if (res.status === 413) {
    throw new PendingUploadError(
      'too_large',
      'Image is too large.',
      body ?? undefined,
    );
  }
  if (res.status === 400 && body) {
    if (body.captcha) {
      throw new PendingUploadError(
        'captcha_required',
        body.captcha.join(' '),
        body,
      );
    }
    if (body.image) {
      // The per-session cap and the per-file size limit both surface here.
      // Distinguishing by message text would be brittle; let the caller
      // show the server's own copy.
      const msg = body.image.join(' ');
      const code: PendingUploadErrorCode = /too large/i.test(msg)
        ? 'too_large'
        : 'rate_limited';
      throw new PendingUploadError(code, msg, body);
    }
  }
  throw new PendingUploadError(
    'server',
    `Upload failed with status ${res.status}`,
    body ?? undefined,
  );
}
