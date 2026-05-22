import { Trans, useTranslation } from 'react-i18next';

const SECTIONS = ['whatWeStore', 'thirdParties', 'rights'] as const;

const THIRD_PARTY_LINKS: Record<string, string> = {
  cloudflare: 'https://www.cloudflare.com/turnstile-privacy-policy/',
  sentry: 'https://sentry.io/privacy/',
  mailtrap: 'https://mailtrap.io/privacy-policy/',
  google: 'https://policies.google.com/privacy',
  facebook: 'https://www.facebook.com/policy.php',
  maptiler: 'https://www.maptiler.com/privacy-policy/',
};

export default function Privacy() {
  const { t } = useTranslation();
  return (
    <main>
      <div className="px-6 py-12">
        <div className="mx-auto max-w-2xl space-y-8">
          <header>
            <h1 className="font-heading mb-4 text-4xl font-bold text-char sm:text-5xl">
              {t('privacy.title')}
            </h1>
            <p className="text-base leading-relaxed text-char/70">
              {t('privacy.intro')}
            </p>
          </header>

          {SECTIONS.map((key) => (
            <section key={key} className="space-y-3">
              <h2 className="font-heading text-2xl font-bold text-char">
                {t(`privacy.sections.${key}.title`)}
              </h2>
              <p className="text-base leading-relaxed text-char/70">
                {t(`privacy.sections.${key}.body`)}
              </p>
              {key === 'thirdParties' && (
                <ul className="list-disc space-y-2 pl-5 text-base leading-relaxed text-char/70">
                  {Object.keys(THIRD_PARTY_LINKS).map((id) => (
                    <li key={id}>
                      <Trans
                        i18nKey={`privacy.sections.thirdParties.items.${id}`}
                        components={{
                          b: <b />,
                          a: (
                            <a
                              href={THIRD_PARTY_LINKS[id]}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="text-amber underline"
                            />
                          ),
                        }}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
