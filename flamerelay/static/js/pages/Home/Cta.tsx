import { Trans, useTranslation } from 'react-i18next';
import { Link } from 'react-router';

export function Cta() {
  const { t } = useTranslation();

  return (
    <section className="parchment-glow px-6 py-20">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="font-heading mb-4 text-3xl font-bold text-char sm:text-4xl">
          {t('home.cta.heading')}
        </h2>
        <p className="mb-8 text-base leading-relaxed text-smoke">
          <Trans
            i18nKey="home.cta.body"
            components={{
              aboutLink: (
                <Link
                  to="/about/"
                  className="font-medium text-amber underline-offset-2 hover:underline"
                />
              ),
            }}
          />
        </p>
        <Link
          to="/about/"
          className="text-sm font-semibold tracking-wide text-amber underline-offset-4 transition-colors hover:underline"
        >
          {t('home.cta.link')} →
        </Link>
      </div>
    </section>
  );
}
