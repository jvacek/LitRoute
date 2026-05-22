import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { entries as changelogEntries } from '../../../../CHANGELOG.md';

const FRESH_CHANGE_MAX_DAYS = 14;
const MS_PER_DAY = 86_400_000;

// Latest date in the changelog. Parsed at build time, so resolved once at
// module load.
const LATEST_DATE: Date | null = (() => {
  const raw = changelogEntries[0]?.date;
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
})();

function daysSince(date: Date): number {
  return Math.floor((Date.now() - date.getTime()) / MS_PER_DAY);
}

export default function BetaBanner() {
  const { t } = useTranslation();
  const days = LATEST_DATE ? daysSince(LATEST_DATE) : null;
  const showFresh = days !== null && days >= 0 && days < FRESH_CHANGE_MAX_DAYS;
  const changesLabel = showFresh
    ? t('beta.seeChangesFresh', {
        ago: days === 0 ? t('beta.today') : t('beta.daysAgo', { count: days }),
      })
    : t('beta.seeChanges');

  return (
    <div className="flex justify-center px-4 pt-3">
      <Link
        to="/changelog/"
        className="group inline-flex max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-full border border-amber/40 bg-amber/10 px-4 py-1.5 text-xs font-medium text-char/80 shadow-sm transition-all hover:-translate-y-px hover:border-amber/60 hover:bg-amber/20 hover:text-char hover:shadow"
      >
        <span className="rounded-full bg-amber px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-char">
          {t('beta.badge')}
        </span>
        <span className="text-char">{t('beta.message')}</span>
        <span aria-hidden="true" className="text-amber/60">
          |
        </span>
        <span className="text-char/80">{t('beta.feedback')}</span>
        <span aria-hidden="true" className="text-amber/60">
          |
        </span>
        <span className="text-char/80">{changesLabel}</span>
        <span
          aria-hidden="true"
          className="text-amber transition-transform group-hover:translate-x-0.5"
        >
          →
        </span>
      </Link>
    </div>
  );
}
