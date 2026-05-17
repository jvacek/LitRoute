import { Trans, useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { GlobePin, SpinningGlobe } from './SpinningGlobe';

export interface Stats {
  active_unit_count: number;
  checkin_count: number;
  followers: number;
  total_distance_traveled_km: number;
}

export function StatsBanner({
  stats,
  pins,
}: {
  stats: Stats | null;
  pins: GlobePin[];
}) {
  const { t } = useTranslation();

  function fmt(n: number | null | undefined): string {
    if (n == null) return '—';
    if (n >= 1000) return n.toLocaleString();
    return String(n);
  }

  const items = [
    {
      value: fmt(stats?.active_unit_count),
      label: t('home.stats.activeLighters'),
    },
    { value: fmt(stats?.checkin_count), label: t('home.stats.checkinsLogged') },
    {
      value: fmt(stats?.followers),
      label: t('home.stats.peopleFollowing'),
    },
    {
      value: stats?.total_distance_traveled_km
        ? `${Math.round(stats.total_distance_traveled_km).toLocaleString()} km`
        : '—',
      label: t('home.stats.traveledSoFar'),
    },
  ];

  return (
    <section className="bg-char px-6 py-16">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-col items-center gap-12">
          {/* Globe */}
          <SpinningGlobe pins={pins} />

          {/* Stats */}
          <dl className="grid w-full grid-cols-2 gap-x-8 gap-y-10 sm:grid-cols-4">
            {items.map(({ value, label }) => (
              <div key={label} className="text-center">
                <dt className="font-heading text-4xl font-bold text-amber sm:text-5xl">
                  {value}
                </dt>
                <dd className="mt-2 text-sm text-smoke">{label}</dd>
              </div>
            ))}
          </dl>

          <p className="text-center text-sm text-smoke/70">
            <Trans
              i18nKey="home.stats.freeText"
              components={{
                supportLink: (
                  <Link
                    to="/support/"
                    className="text-amber transition-colors hover:text-amber/80"
                  />
                ),
              }}
            />
          </p>
        </div>
      </div>
    </section>
  );
}
