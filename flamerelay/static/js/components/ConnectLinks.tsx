import { useTranslation } from 'react-i18next';
import DiscordIcon from '../assets/logos/Discord-Symbol-Black.svg?react';
import GitHubIcon from '../assets/logos/GitHub_Invertocat_Black.svg?react';
import MastodonIcon from '../assets/logos/mastodon.svg?react';
import RedditIcon from '../assets/logos/Reddit_Icon_2Color.svg?react';

const GITHUB_REPO_URL = 'https://github.com/jvacek/flamerelay';
const DISCORD_URL = 'https://discord.gg/6sShax8UgF';
const REDDIT_URL = 'https://reddit.com/r/litroute';
const MASTODON_URL = 'https://fosstodon.org/@jvacek';

// `stacked`: render the two cards in a single column (used on /changelog/
// where this whole block is itself one column of a two-column layout).
// Default is side-by-side from the `sm` breakpoint up.
export default function ConnectLinks({
  stacked = false,
}: {
  stacked?: boolean;
}) {
  const { t } = useTranslation();
  const gridClass = stacked
    ? 'grid grid-cols-1 gap-5'
    : 'grid grid-cols-1 gap-5 sm:grid-cols-2';
  return (
    <div className={gridClass}>
      <div className="rounded-card border border-char/10 bg-white px-5 py-5">
        <h3 className="font-heading mb-4 text-xs font-bold uppercase tracking-wider text-char/50">
          {t('about.connect.followLabel')}
        </h3>
        <ul className="space-y-3">
          <li>
            <a
              href={DISCORD_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center gap-3 text-base text-char transition-colors hover:text-amber"
            >
              <DiscordIcon
                aria-hidden="true"
                className="h-5 w-5 text-char/70 transition-colors group-hover:text-amber"
              />
              {t('about.connect.discord')}
            </a>
          </li>
          <li>
            <a
              href={REDDIT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center gap-3 text-base text-char transition-colors hover:text-amber"
            >
              <RedditIcon
                aria-hidden="true"
                className="h-5 w-5 text-char/70 transition-colors group-hover:text-amber"
              />
              {t('about.connect.reddit')}
            </a>
          </li>
          <li>
            <a
              href={MASTODON_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center gap-3 text-base text-char transition-colors hover:text-amber"
            >
              <MastodonIcon
                aria-hidden="true"
                className="h-5 w-5 text-char/70 transition-colors group-hover:text-amber"
              />
              {t('about.connect.mastodon')}
            </a>
          </li>
        </ul>
      </div>

      <a
        href={GITHUB_REPO_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="group flex flex-col rounded-card border-2 border-amber bg-amber/15 px-5 py-5 shadow-sm transition-all hover:-translate-y-px hover:bg-amber/25 hover:shadow"
      >
        <div className="mb-3 flex items-center gap-3">
          <GitHubIcon aria-hidden="true" className="h-6 w-6 text-char" />
          <h3 className="font-heading text-base font-bold text-char">
            {t('about.connect.githubTitle')}
          </h3>
        </div>
        <p className="mb-3 text-sm leading-relaxed text-char/70">
          {t('about.connect.githubBody')}
        </p>
        <span className="mt-auto text-sm font-semibold text-char underline decoration-amber decoration-2 underline-offset-2 group-hover:decoration-char">
          {t('about.connect.githubCta')} →
        </span>
      </a>
    </div>
  );
}
