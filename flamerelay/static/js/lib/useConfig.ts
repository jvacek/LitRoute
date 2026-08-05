import { useRouteLoaderData } from 'react-router';
import type { Config, RootLoaderData } from '../pages/root.loader';

export type { Config } from '../pages/root.loader';

/**
 * App-wide runtime config, sourced from the root route loader. Guaranteed
 * non-null inside the router tree — the root loader resolves (with a
 * fallback shape on fetch failure) before any descendant renders.
 */
export function useConfig(): Config {
  const data = useRouteLoaderData('root') as RootLoaderData | undefined;
  if (!data) {
    throw new Error(
      'useConfig() must be used inside a route descendant of the root layout',
    );
  }
  return data.config;
}
