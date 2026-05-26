import { Trans, useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import QA, { useLighterFaq } from '../components/QA';

export default function ContributorGuide() {
  const { adminUrl } = useAuth();
  const { t } = useTranslation();
  const lighterFaq = useLighterFaq();

  const steps = [
    {
      n: '1',
      q: t('contributorGuide.steps.createUnit.q'),
      a: (
        <p>
          <Trans
            i18nKey="contributorGuide.steps.createUnit.a"
            components={{ b: <strong />, code: <code /> }}
          />
        </p>
      ),
      tip: <Trans i18nKey="contributorGuide.steps.createUnit.tip" />,
    },
    {
      n: '2',
      q: t('contributorGuide.steps.makeLabel.q'),
      a: (
        <p>
          <Trans
            i18nKey="contributorGuide.steps.makeLabel.a"
            components={{ b: <strong /> }}
          />
        </p>
      ),
      tip: (
        <Trans
          i18nKey="contributorGuide.steps.makeLabel.tip"
          components={{ em: <em /> }}
        />
      ),
    },
    {
      n: '3',
      q: t('contributorGuide.steps.attachLabel.q'),
      a: (
        <p>
          <Trans
            i18nKey="contributorGuide.steps.attachLabel.a"
            components={{ b: <strong /> }}
          />
        </p>
      ),
      tip: <Trans i18nKey="contributorGuide.steps.attachLabel.tip" />,
    },
    {
      n: '4',
      q: t('contributorGuide.steps.firstCheckin.q'),
      a: <p>{t('contributorGuide.steps.firstCheckin.a')}</p>,
    },
    {
      n: '5',
      q: t('contributorGuide.steps.handOff.q'),
      a: <p>{t('contributorGuide.steps.handOff.a')}</p>,
    },
  ];

  return (
    <main>
      <div className="bg-char px-6 py-12">
        <div className="mx-auto max-w-2xl">
          <header>
            <p className="font-heading mb-4 text-4xl font-bold leading-tight text-amber sm:text-5xl">
              {t('contributorGuide.header')}
            </p>
            <p className="text-base leading-relaxed text-parchment/70">
              {t('contributorGuide.subheader')}
            </p>
            {adminUrl && (
              <a
                href={adminUrl}
                className="mt-6 inline-block rounded-btn bg-amber px-5 py-2.5 text-sm font-medium tracking-wide text-white transition-transform hover:-translate-y-px active:translate-y-0"
              >
                {t('contributorGuide.openAdmin')}
              </a>
            )}
          </header>
        </div>
      </div>

      <div className="px-6 py-12">
        <div className="mx-auto max-w-2xl">
          <p className="font-heading mb-3 text-xl font-semibold text-char">
            {t('contributorGuide.greeting')}
          </p>
          <p className="mb-4 text-sm leading-relaxed text-char/70">
            {t('contributorGuide.greetingBody1')}
          </p>
          <p className="text-sm leading-relaxed text-char/70">
            {t('contributorGuide.greetingBody2')}
          </p>
        </div>
      </div>

      <div className="px-6 pb-14">
        <div className="mx-auto max-w-2xl">
          <section>
            <h2 className="font-heading mb-8 text-2xl font-bold text-char">
              {t('contributorGuide.stepsTitle')}
            </h2>
            <div className="space-y-4">
              {steps.map(({ n, q, a, tip }) => (
                <div
                  key={n}
                  className="flex gap-5 rounded-card bg-white px-6 py-5 shadow-sm"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber text-sm font-bold text-white">
                    {n}
                  </div>
                  <div className="pt-0.5 w-full">
                    <QA q={q} a={a} />
                    {tip && (
                      <p className="mt-3 rounded-card bg-amber/10 px-4 py-3 text-sm leading-relaxed text-char/70 [&_em]:not-italic [&_em]:font-medium [&_strong]:text-char">
                        <span className="mr-1.5 text-amber">✦</span>
                        {tip}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      <div className="bg-char px-6 py-14">
        <div className="mx-auto max-w-2xl">
          <section>
            <h2 className="font-heading mb-2 text-2xl font-bold text-parchment">
              {t('contributorGuide.passingOnTitle')}
            </h2>
            <p className="mb-8 text-sm text-parchment/60">
              {t('contributorGuide.passingOnSubtext')}
            </p>
            <div className="space-y-8">
              {lighterFaq.map(({ q, a }) => (
                <QA key={q} q={q} a={a} dark />
              ))}
            </div>
          </section>
        </div>
      </div>

      <div className="px-6 py-14">
        <div className="mx-auto max-w-2xl">
          <p className="text-sm text-char/60">
            <Trans
              i18nKey="contributorGuide.footerText"
              components={{
                aboutLink: (
                  <Link
                    to="/about/"
                    className="text-amber underline-offset-2 hover:underline"
                  />
                ),
              }}
            />
          </p>
        </div>
      </div>
    </main>
  );
}
