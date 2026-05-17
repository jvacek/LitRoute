export const IS_LOCAL = __IS_LOCAL__;
export const GIT_COMMIT = __GIT_COMMIT__;

function readMeta(name: string): string {
  const el = document.querySelector(`meta[name="${name}"]`);
  return el?.getAttribute('content') ?? '';
}

export const SENTRY_DSN = readMeta('sentry-dsn');
export const SENTRY_ENVIRONMENT = readMeta('sentry-environment');
