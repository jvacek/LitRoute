import { apiClient } from '../../api/client';
import type { components } from '../../api/schema';

export type HomeLoaderData = {
  stats: components['schemas']['Stats'] | null;
  pins: components['schemas']['GlobePin'][];
};

// Both endpoints are decorative — failures leave the banner / globe in their
// empty state. Catch errors so a flaky API can't block the QR-landing
// fallback page from rendering. (errorElement isn't appropriate here — these
// are not load-bearing for the page.)
export async function homeLoader(): Promise<HomeLoaderData> {
  const [statsResp, pinsResp] = await Promise.all([
    apiClient.GET('/api/stats/').catch(() => null),
    apiClient.GET('/api/globe-pins/').catch(() => null),
  ]);
  return {
    stats: statsResp?.data ?? null,
    pins: pinsResp?.data?.pins ?? [],
  };
}
