import * as Sentry from '@sentry/react';

/**
 * Report an unexpected error to both the dev console and Sentry.
 *
 * Use this in any `.catch` or `try/catch` block where the error is unexpected
 * (network failure, server 5xx, malformed response). Expected user-visible
 * states (401, 404) should be handled with explicit code paths, not reported.
 *
 * `context` is attached to the Sentry event as the `extra` payload — pass a
 * short string describing the call site (e.g. `{ where: 'Unit.subscribe' }`)
 * so issues group cleanly in the Sentry UI.
 */
export function reportError(
  err: unknown,
  context?: Record<string, unknown>,
): void {
  console.error(err);
  Sentry.captureException(err, context ? { extra: context } : undefined);
}
