import { useTranslation } from 'react-i18next';
import ConnectLinks from '../components/ConnectLinks';
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
      {/* Header + disclaimer — narrow */}
      <div className="px-6 pb-8 pt-12">
        <div className="mx-auto max-w-xl">
          <header className="mb-8">
            <h1 className="font-heading mb-3 text-4xl font-bold leading-tight text-amber sm:text-5xl">
              {t('changelog.title')}
            </h1>
            <p className="text-base leading-relaxed text-char/70">
              {t('changelog.subtitle')}
            </p>
          </header>

          <section className="rounded-card border border-amber/30 bg-amber/10 px-5 py-4 text-sm leading-relaxed text-char/80">
            {t('changelog.disclaimer')}
          </section>
        </div>
      </div>

      {/* Connect + Feedback — wider, escapes the narrow column */}
      <div className="px-6 py-8">
        <div className="mx-auto grid max-w-4xl grid-cols-1 gap-8 lg:grid-cols-2">
          <section>
            <h2 className="font-heading mb-4 text-2xl font-bold text-char">
              {t('about.connect.title')}
            </h2>
            {/* Phone (< sm): stacked vertically for readability on iPhone-sized
                screens. Tablet/large-phone (sm to lg-1): side-by-side, since
                the feedback form is below — there's room to spread out. lg+:
                stacked again, because this is now one narrow column next to
                the feedback form. */}
            <ConnectLinks gridClassName="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-1" />
          </section>

          <section>
            <h2 className="font-heading mb-3 text-2xl font-bold text-char">
              {t('changelog.feedbackHeading')}
            </h2>
            <p className="mb-4 text-base leading-relaxed text-char/70">
              {t('changelog.feedbackSubheading')}
            </p>
            <FeedbackForm />
          </section>
        </div>
      </div>

      {/* History — narrow */}
      <div className="px-6 pb-12 pt-4">
        <div className="mx-auto max-w-xl">
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
