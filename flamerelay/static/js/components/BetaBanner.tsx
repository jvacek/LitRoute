import { Fragment, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
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

  const messages = useMemo(
    () => [
      { key: 'wip', label: t('beta.message'), highlight: false },
      { key: 'changes', label: changesLabel, highlight: true },
      { key: 'will-break', label: t('beta.willBreak'), highlight: false },
      { key: 'feedback', label: t('beta.feedback'), highlight: false },
    ],
    [t, changesLabel],
  );

  return (
    <div className={`flex justify-center px-3 ${wrapperClassName}`}>
      <Link
        to="/changelog/"
        className="ticker-pause-on-hover group inline-flex items-center gap-2 overflow-hidden rounded-full border border-amber/60 bg-amber/30 px-3 py-1 text-[11px] font-semibold text-char shadow-sm backdrop-blur-md transition-all hover:-translate-y-px hover:border-amber hover:bg-amber/40 hover:shadow"
      >
        <span className="rounded-full bg-amber px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-char">
          {t('beta.badge')}
        </span>
        {/* Stock-ticker scroll. Two copies of the message list slide leftward
            in lockstep; at -50% the second copy lands exactly where the first
            started, so the loop is seamless. A `·` separator follows every
            message (including the last of copy 1, which visually divides it
            from the first of copy 2). CSS lives in project.css. */}
        <span className="block w-[280px] overflow-hidden font-mono">
          <span className="ticker-scroll inline-flex w-max items-center whitespace-nowrap">
            {[0, 1].map((copy) =>
              messages.map((m) => (
                <Fragment key={`${copy}-${m.key}`}>
                  <span
                    aria-hidden={copy === 1 ? 'true' : undefined}
                    className={
                      m.highlight
                        ? 'font-bold underline decoration-amber decoration-2 underline-offset-2'
                        : ''
                    }
                  >
                    {m.label}
                  </span>
                  <span aria-hidden="true" className="mx-1.5 text-char/50">
                    |
                  </span>
                </Fragment>
              )),
            )}
          </span>
        </span>
      </Link>
    </div>
  );
}
