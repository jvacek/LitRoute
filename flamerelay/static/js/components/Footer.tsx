import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import logoUrl from '../../images/favicons/litroute.svg';
import DiscordIcon from '../assets/logos/Discord-Symbol-Black.svg?react';
import GitHubIcon from '../assets/logos/GitHub_Invertocat_Black.svg?react';
import InstagramIcon from '../assets/logos/instagram.svg?react';
import RedditIcon from '../assets/logos/Reddit_Icon_2Color.svg?react';

const SOCIAL_LINKS = [
  {
    href: 'https://instagram.com/lit_route',
    labelKey: 'LitRoute on Instagram',
    Icon: InstagramIcon,
  },
  {
    href: 'https://reddit.com/r/litroute',
    labelKey: 'LitRoute on Reddit',
    Icon: RedditIcon,
  },
  {
    href: 'https://discord.gg/6sShax8UgF',
    labelKey: 'LitRoute on Discord',
    Icon: DiscordIcon,
  },
];

export default function Footer() {
  const { t } = useTranslation();
  const commitUrl = __GIT_COMMIT__
    ? `${__GITHUB_REPO_URL__}/commit/${__GIT_COMMIT__}`
    : __GITHUB_REPO_URL__;

  return (
    <footer className="mt-16 border-t border-char/10 bg-parchment py-10">
      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <Link
            to="/"
            className="flex items-center gap-2"
            aria-label={t('nav.homeAriaLabel')}
          >
            <img src={logoUrl} alt="" aria-hidden="true" className="h-8 w-8" />
            <span className="font-heading text-lg font-bold tracking-tight">
              <span className="text-amber">Lit</span>
              <span className="text-char">Route</span>
            </span>
          </Link>
          <p className="text-xs text-char/50">{t('footer.tagline')}</p>
        </div>

        <nav
          className="flex flex-col gap-2 sm:items-center"
          aria-label={t('footer.footerNav')}
        >
          <Link
            to="/about/"
            className="text-xs text-char/60 transition-colors hover:text-char"
          >
            {t('common.about')}
          </Link>
          <Link
            to="/privacy/"
            className="text-xs text-char/60 transition-colors hover:text-char"
          >
            {t('privacy.title')}
          </Link>
          <Link
            to="/terms/"
            className="text-xs text-char/60 transition-colors hover:text-char"
          >
            {t('terms.title')}
          </Link>
          <Link
            to="/changelog/"
            className="text-xs text-char/60 transition-colors hover:text-char"
          >
            {t('footer.changelog')}
          </Link>
          <Link
            to="/feedback/"
            className="text-xs text-amber transition-colors hover:text-amber/80"
          >
            ✦ {t('footer.feedback')} ✦
          </Link>
          <Link
            to="/support/"
            className="text-xs text-amber transition-colors hover:text-amber/80"
          >
            ♥ {t('common.support')} ♥
          </Link>
        </nav>

        <div className="flex flex-col gap-2 sm:items-end">
          <span className="text-xs text-char/50">
            © {new Date().getFullYear()} LitRoute
          </span>
          <div className="flex items-center gap-3">
            {SOCIAL_LINKS.map(({ href, labelKey, Icon }) => (
              <a
                key={href}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={labelKey}
                className="text-char/40 transition-colors hover:text-char/70"
              >
                <Icon aria-hidden="true" className="h-4 w-4" />
              </a>
            ))}
            {commitUrl && (
              <a
                href={commitUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t('footer.viewCommit')}
                className="text-char/40 transition-colors hover:text-char/70"
              >
                <GitHubIcon aria-hidden="true" className="h-4 w-4" />
              </a>
            )}
          </div>
        </div>
      </div>
    </footer>
  );
}
