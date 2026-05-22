import { useTranslation } from 'react-i18next';
import FeedbackForm from '../components/FeedbackForm';
import { entries } from '../../../../CHANGELOG.md';

// CHANGELOG.md is author-controlled and parsed by
// webpack/loaders/changelog-loader.js at build time, so the HTML it produces
// never sees user input — safe to inject.
function ChangelogBody({ html }: { html: string }) {
  return (
    <div
      className="changelog-body"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export default function Changelog() {
  const { t } = useTranslation();

  return (
    <main>
      <div className="px-6 py-12">
        <div className="mx-auto max-w-xl">
          <header className="mb-8">
            <h1 className="font-heading mb-3 text-4xl font-bold leading-tight text-amber sm:text-5xl">
              {t('changelog.title')}
            </h1>
            <p className="text-base leading-relaxed text-char/70">
              {t('changelog.subtitle')}
            </p>
          </header>

          <section className="mb-10 rounded-card border border-amber/30 bg-amber/10 px-5 py-4 text-sm leading-relaxed text-char/80">
            {t('changelog.disclaimer')}
          </section>

          <section className="mb-12">
            <h2 className="font-heading mb-3 text-2xl font-bold text-char">
              {t('changelog.feedbackHeading')}
            </h2>
            <p className="mb-4 text-base leading-relaxed text-char/70">
              {t('changelog.feedbackSubheading')}
            </p>
            <FeedbackForm />
          </section>

          <section>
            <h2 className="font-heading mb-6 text-2xl font-bold text-char">
              {t('changelog.historyHeading')}
            </h2>
            {entries.length === 0 ? (
              <p className="text-base text-char/60">{t('changelog.empty')}</p>
            ) : (
              <ol className="space-y-6">
                {entries.map((entry) => (
                  <li
                    key={entry.date}
                    className="rounded-card border border-char/10 bg-white px-6 py-6 shadow-sm sm:px-8 sm:py-7"
                  >
                    <h3 className="font-heading mb-4 text-xl font-bold text-amber">
                      {entry.date}
                    </h3>
                    <ChangelogBody html={entry.html} />
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
