import { useTranslation } from 'react-i18next';
import { Link, useLoaderData, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { logout } from '../lib/allauthApi';
import {
  actionAmberBtnMd,
  actionCharBtnMd,
  actionEmberBtnMd,
  actionMutedBtnMd,
} from '../styles';
import type { UserDetailLoaderData } from './UserDetail.loader';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2)
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export default function UserDetail() {
  const { t } = useTranslation();
  const { username, name, adminUrl, refresh } = useAuth();
  const navigate = useNavigate();
  const { followedUnits } = useLoaderData() as UserDetailLoaderData;

  const displayName = name || username;

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
          <ul className="grid gap-3 sm:grid-cols-2">
            {followedUnits.map((unit) => (
              <li key={unit.identifier}>
                <Link
                  to={`/unit/${unit.identifier}/`}
                  className="flex items-center justify-between rounded-card border border-smoke/20 bg-white px-4 py-3 hover:border-amber/60 hover:shadow-sm"
                >
                  <span className="font-heading font-semibold text-char">
                    {unit.identifier}
                  </span>
                  <span className="text-sm text-smoke">
                    {t('userDetail.checkins', { count: unit.checkin_count })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
