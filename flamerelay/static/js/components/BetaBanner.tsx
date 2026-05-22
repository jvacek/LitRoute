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

// Callers own the vertical padding via `wrapperClassName` because the
// surrounding space differs by page — the home Hero has a sub-headline above
// and a form below, while non-home pages sit the banner directly under the
// sticky navbar and the page-level top padding.
export default function BetaBanner({
  wrapperClassName = '',
}: {
  wrapperClassName?: string;
}) {
  const { t } = useTranslation();
  const days = LATEST_DATE ? daysSince(LATEST_DATE) : null;
  const showFresh = days !== null && days >= 0 && days < FRESH_CHANGE_MAX_DAYS;
  const changesLabel = showFresh
    ? t('beta.seeChangesFresh', {
        ago: days === 0 ? t('beta.today') : t('beta.daysAgo', { count: days }),
      })
    : t('beta.seeChanges');

  return (
    <div className={`flex justify-center px-3 ${wrapperClassName}`}>
      <Link
        to="/changelog/"
        className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-amber/60 bg-amber/30 px-3 py-1 text-[11px] font-medium text-char shadow-sm backdrop-blur-md transition-all hover:-translate-y-px hover:border-amber hover:bg-amber/40 hover:shadow"
      >
        <span className="rounded-full bg-amber px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-char">
          {t('beta.badge')}
        </span>
        <span>{t('beta.message')}</span>
        <span aria-hidden="true" className="text-amber/70">
          |
        </span>
        <span>{t('beta.feedback')}</span>
        <span aria-hidden="true" className="text-amber/70">
          |
        </span>
        <span className="font-semibold underline decoration-amber decoration-2 underline-offset-2">
          {changesLabel}
        </span>
      </Link>
    </div>
  );
}
