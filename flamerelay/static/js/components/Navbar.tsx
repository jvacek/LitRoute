import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { useAuth } from '../AuthContext';
import { IS_LOCAL } from '../env';
import logoUrl from '../../images/favicons/litroute.svg';
import { primaryBtnMd } from '../styles';
import LanguagePicker from './LanguagePicker';

export default function Navbar() {
  const { isAuthenticated } = useAuth();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const headerBg = IS_LOCAL ? 'blueprint-bg' : 'bg-parchment';

  return (
    <header className={`sticky top-0 z-50 border-b border-char/8 ${headerBg}`}>
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
        {/* Brand */}
        <Link
          to="/"
          className="flex items-center gap-2"
          aria-label={t('nav.homeAriaLabel')}
        >
          <img
            src={logoUrl}
            alt=""
            aria-hidden="true"
            className={`h-12 w-12 ${IS_LOCAL ? 'logo-outline' : ''}`}
          />
          <span className="font-heading text-2xl font-bold tracking-tight">
            <span className="text-amber">Lit</span>
            <span className="text-char">Route</span>
          </span>
        </Link>

        {/* Desktop nav */}
        <nav
          className="hidden items-center gap-8 md:flex"
          aria-label={t('nav.mainNav')}
        >
          <NavLinks isAuthenticated={isAuthenticated} />
        </nav>

        {/* Mobile toggle */}
        <button
          className="flex h-10 w-10 flex-col items-center justify-center gap-1.5 rounded-btn md:hidden"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={t('nav.toggleNav')}
        >
          <span
            className={`block h-0.5 w-5 bg-char transition-transform duration-200 ${open ? 'translate-y-2 rotate-45' : ''}`}
          />
          <span
            className={`block h-0.5 w-5 bg-char transition-opacity duration-200 ${open ? 'opacity-0' : ''}`}
          />
          <span
            className={`block h-0.5 w-5 bg-char transition-transform duration-200 ${open ? '-translate-y-2 -rotate-45' : ''}`}
          />
        </button>
      </div>

      {/* Mobile menu */}
      {open && (
        <div
          className={`border-t border-char/8 ${headerBg} px-6 pb-4 md:hidden`}
        >
          <nav
            className="flex flex-col gap-1 pt-2"
            aria-label={t('nav.mobileNav')}
          >
            <MobileNavLinks
              isAuthenticated={isAuthenticated}
              onNavigate={() => setOpen(false)}
            />
          </nav>
        </div>
      )}
    </header>
  );
}

// ── Icons ────────────────────────────────────────────────────────────────────

function HeartIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4 fill-current"
      aria-hidden="true"
    >
      <path d="M12 21.593c-.525-.445-4.973-4.17-7.127-6.474C2.682 12.83 2 11.62 2 10a5 5 0 0 1 8.535-3.536L12 7.93l1.465-1.465A5 5 0 0 1 22 10c0 1.62-.682 2.83-2.873 5.119C16.973 17.423 12.525 21.148 12 21.593z" />
    </svg>
  );
}

// ── Desktop links ────────────────────────────────────────────────────────────

function NavLinks({ isAuthenticated }: { isAuthenticated: boolean }) {
  const { t } = useTranslation();
  const linkClass =
    'text-sm font-medium text-char/70 transition-colors hover:text-char';

  return (
    <>
      <LanguagePicker />
      <Link
        to="/support/"
        className="text-amber/70 transition-colors hover:text-amber"
        aria-label={t('nav.supportAriaLabel')}
      >
        <HeartIcon />
      </Link>
      <Link to="/about/" className={linkClass}>
        {t('common.about')}
      </Link>
      {isAuthenticated ? (
        <Link
          to="/profile/"
          className="rounded-btn border border-char/20 px-[18px] py-[7px] text-sm font-semibold text-char transition-colors hover:border-char/40 hover:bg-char/5"
        >
          {t('common.profile')}
        </Link>
      ) : (
        <Link to="/accounts/login/" className={primaryBtnMd}>
          {t('nav.signIn')}
        </Link>
      )}
    </>
  );
}

// ── Mobile links ─────────────────────────────────────────────────────────────

function MobileNavLinks({
  isAuthenticated,
  onNavigate,
}: {
  isAuthenticated: boolean;
  onNavigate: () => void;
}) {
  const { t } = useTranslation();
  const linkClass =
    'block rounded-btn px-2 py-2.5 text-sm font-medium text-char/80 transition-colors hover:bg-linen hover:text-char';

  return (
    <>
      <div className="px-2 py-1.5">
        <LanguagePicker />
      </div>
      <Link to="/support/" className={linkClass} onClick={onNavigate}>
        ♥ {t('common.support')}
      </Link>
      <Link to="/about/" className={linkClass} onClick={onNavigate}>
        {t('common.about')}
      </Link>
      {isAuthenticated ? (
        <Link to="/profile/" className={linkClass} onClick={onNavigate}>
          {t('common.profile')}
        </Link>
      ) : (
        <Link to="/accounts/login/" className={linkClass} onClick={onNavigate}>
          {t('nav.signIn')}
        </Link>
      )}
    </>
  );
}
