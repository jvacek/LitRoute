import { useEffect, useState } from 'react';

import { reportError } from './sentry';

export interface Config {
  maptilerKey: string;
  allowRegistration: boolean;
  turnstileSiteKey: string;
}

let configPromise: Promise<Config> | null = null;

function fetchConfig(): Promise<Config> {
  if (!configPromise) {
    configPromise = fetch('/api/config/')
      .then((r) => {
        if (!r.ok) throw new Error(`config fetch failed: ${r.status}`);
        return r.json() as Promise<Config>;
      })
      .catch((err: unknown) => {
        configPromise = null;
        reportError(err, { where: 'useConfig.fetch' });
        return {
          maptilerKey: '',
          allowRegistration: false,
          turnstileSiteKey: '',
        };
      });
  }
  return configPromise;
}

export function useConfig(): Config | null {
  const [config, setConfig] = useState<Config | null>(null);

  useEffect(() => {
    void fetchConfig().then(setConfig);
  }, []);

  return config;
}
