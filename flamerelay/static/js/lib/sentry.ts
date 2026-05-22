import * as Sentry from '@sentry/react';

/**
 * True for fetches that died on the wire: TCP drop, DNS, CORS, user
 * navigating away mid-request, app backgrounded mid-upload. iOS Safari says
 * "Load failed", Chromium says "Failed to fetch", Firefox says "NetworkError
 * when attempting to fetch resource". AbortError is an intentional abort.
 */
export function isNetworkError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  if (!(err instanceof TypeError)) return false;
  const message = err.message;
  return (
    message.includes('Load failed') ||
    message.includes('Failed to fetch') ||
    message.includes('NetworkError when attempting to fetch')
  );
}

/**
 * Report an unexpected error to both the dev console and Sentry.
 *
 * Use this in any `.catch` or `try/catch` block where the error is unexpected
 * (server 5xx, malformed response, bug). Expected user-visible states (401,
 * 404) should be handled with explicit code paths, not reported. Client-side
 * network failures are filtered out — they're environmental noise, not bugs,
 * and the calling code should surface a retry-friendly message to the user.
 *
 * `context` is attached to the Sentry event as the `extra` payload — pass a
 * short string describing the call site (e.g. `{ where: 'Unit.follow' }`)
 * so issues group cleanly in the Sentry UI.
 */
export function reportError(
  err: unknown,
  context?: Record<string, unknown>,
): void {
  console.error(err);
  if (isNetworkError(err)) return;
  Sentry.captureException(err, context ? { extra: context } : undefined);
}
