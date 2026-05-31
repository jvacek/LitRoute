import { useTranslation } from 'react-i18next';
import { Link, useLoaderData, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import TeamBadge from '../components/TeamBadge';
import { logout } from '../lib/allauthApi';
import {
  actionAmberBtnMd,
  actionCharBtnMd,
  actionEmberBtnMd,
  actionMutedBtnMd,
} from '../styles';
import type { FollowedUnit, UserDetailLoaderData } from './UserDetail.loader';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2)
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

// A check-in is a location ping, so the count uses a map-pin glyph. Inline SVG
// (currentColor) to match the project's icon convention — no icon library.
function MapPinIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

// Rolling time buckets relative to page load: a fixed key for recent
// check-ins, the check-in's calendar year for anything older than ~30 days,
// and 'never' for units with no check-in. The followed-units list arrives
// sorted by last check-in (most recent first, never-checked-in last), so a Map
// keyed in insertion order yields the right group order without a separate
// sort: today → this week → this month → descending years → never. The
// thresholds are display-only, not business constants.
const DAY_MS = 24 * 60 * 60 * 1000;

type UnitGroup = { key: string; year: number | null; units: FollowedUnit[] };

function bucketFor(
  unit: FollowedUnit,
  now: number,
): { key: string; year: number | null } {
  if (!unit.last_checkin_date) return { key: 'never', year: null };
  const date = new Date(unit.last_checkin_date);
  const age = now - date.getTime();
  if (age < DAY_MS) return { key: 'lastDay', year: null };
  if (age < 7 * DAY_MS) return { key: 'lastWeek', year: null };
  if (age < 30 * DAY_MS) return { key: 'lastMonth', year: null };
  const year = date.getFullYear();
  return { key: `year-${year}`, year };
}

function groupUnits(units: FollowedUnit[]): UnitGroup[] {
  const now = Date.now();
  const groups = new Map<string, UnitGroup>();
  for (const unit of units) {
    const { key, year } = bucketFor(unit, now);
    let group = groups.get(key);
    if (!group) {
      group = { key, year, units: [] };
      groups.set(key, group);
    }
    group.units.push(unit);
  }
  return [...groups.values()];
}

export default function UserDetail() {
  const { t, i18n } = useTranslation();
  const { username, name, adminUrl, refresh } = useAuth();
  const navigate = useNavigate();
  const { followedUnits } = useLoaderData() as UserDetailLoaderData;

  const displayName = name || username;
  const groups = groupUnits(followedUnits);

  function renderUnit(unit: FollowedUnit) {
    // Date lives on the identifier row; line 2 carries who + place (place last,
    // since it's the longest and the first to truncate).
    const date = unit.last_checkin_date
      ? new Date(unit.last_checkin_date).toLocaleDateString(
          i18n.resolvedLanguage,
          { day: 'numeric', month: 'short', year: 'numeric' },
        )
      : null;
    const meta = unit.last_checkin_date
      ? [
          unit.last_checkin_by || t('userDetail.anonymous'),
          unit.last_checkin_place || t('userDetail.unknownPlace'),
        ].join(' · ')
      : t('userDetail.noCheckinsYet');
    return (
      <li key={unit.identifier}>
        <Link
          to={`/unit/${unit.identifier}/`}
          className="flex flex-col gap-1 rounded-card border border-smoke/20 bg-white px-4 py-3 hover:border-amber/60 hover:shadow-sm"
        >
          <span className="flex items-center justify-between gap-2">
            <span className="font-heading min-w-0 truncate font-semibold text-char">
              {unit.identifier}
            </span>
            <span className="flex shrink-0 items-center gap-2 text-sm text-smoke">
              {unit.checkin_count > 0 && (
                <span
                  className="flex items-center gap-1"
                  title={t('userDetail.checkins', {
                    count: unit.checkin_count,
                  })}
                >
                  {unit.checkin_count}
                  <MapPinIcon />
                </span>
              )}
              {date && <span>{date}</span>}
            </span>
          </span>
          <span className="truncate text-sm text-smoke">{meta}</span>
          {(unit.team || unit.game) && (
            <span className="flex min-w-0 items-center gap-2 text-sm text-smoke">
              {unit.team && (
                <TeamBadge name={unit.team.name} color={unit.team.color} />
              )}
              {unit.game && <span className="truncate">{unit.game.name}</span>}
            </span>
          )}
        </Link>
      </li>
    );
  }

  async function handleLogout() {
    try {
      await logout();
    } finally {
      await refresh();
      navigate('/');
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="mb-8 flex items-center gap-5">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-amber text-xl font-bold text-white">
          {initials(displayName)}
        </div>
        <div>
          <h1 className="font-heading text-3xl font-bold text-char">
            {displayName}
          </h1>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-3">
          {adminUrl && (
            <>
              <a href={adminUrl} className={actionCharBtnMd}>
                {t('userDetail.admin')}
              </a>
              <Link to="/contribute/" className={actionMutedBtnMd}>
                {t('userDetail.contributorGuide')}
              </Link>
            </>
          )}
        </div>
        <div className="flex flex-wrap gap-3">
          <Link to="/profile/settings/" className={actionAmberBtnMd}>
            {t('common.settings')}
          </Link>
          <button
            type="button"
            onClick={handleLogout}
            className={actionEmberBtnMd}
          >
            {t('userDetail.signOut')}
          </button>
        </div>
      </div>

      <section className="mt-10 border-t border-char/10 pt-8">
        <h2 className="font-heading mb-4 text-xl font-semibold text-char">
          {t('userDetail.followedUnits')}
        </h2>
        {followedUnits.length === 0 ? (
          <p className="text-smoke">{t('userDetail.noFollows')}</p>
        ) : (
          <div className="space-y-8">
            {groups.map(({ key, year, units }) => (
              <div key={key}>
                <h3 className="font-heading mb-3 text-sm font-semibold tracking-wide text-smoke uppercase">
                  {year != null ? year : t(`userDetail.groups.${key}`)}
                </h3>
                <ul className="grid gap-3 sm:grid-cols-2">
                  {units.map(renderUnit)}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
