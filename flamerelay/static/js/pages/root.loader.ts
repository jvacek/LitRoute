import { apiClient } from '../api/client';
import type { components } from '../api/schema';
import { reportError } from '../lib/sentry';

export type Config = components['schemas']['Config'];

export interface RootLoaderData {
  config: Config;
}

// Soft-fail shape — if /api/config/ is down, maps and turnstile silently
// skip rendering instead of taking the whole app down.
const FALLBACK_CONFIG: Config = {
  maptilerKey: '',
  allowRegistration: false,
  turnstileSiteKey: '',
};

// React Router fires the parent loader on every navigation. Cache the
// promise so /api/config/ is hit at most once per page load. A failed
// fetch clears the cache so the next nav can retry.
let configPromise: Promise<Config> | null = null;

function loadConfig(): Promise<Config> {
  configPromise ??= apiClient
    .GET('/api/config/')
    .then((resp) => {
      if (!resp.data) {
        throw new Error(`config fetch failed: ${resp.response.status}`);
      }
      return resp.data;
    })
    .catch((err: unknown) => {
      configPromise = null;
      reportError(err, { where: 'rootLoader.config' });
      return FALLBACK_CONFIG;
    });
  return configPromise;
}

export async function rootLoader(): Promise<RootLoaderData> {
  return { config: await loadConfig() };
}
