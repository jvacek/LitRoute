import { Trans, useTranslation } from 'react-i18next';
import ConnectLinks from '../components/ConnectLinks';
import FeedbackForm from '../components/FeedbackForm';
import QA, { useLighterFaq } from '../components/QA';
import SupportSection from '../components/SupportSection';

export default function About() {
  const { t } = useTranslation();
  const lighterFaq = useLighterFaq();

  const emailHref = `mailto:${atob('Y29udGFjdEBsaXRyb3V0ZS5jb20=')}`;
  // TODO: update with your actual Weblate project URL
  const weblateUrl = 'https://hosted.weblate.org/projects/litroute/';

  const aboutQa = [
    {
      q: t('about.qa.why.q'),
      a: <p>{t('about.qa.why.a')}</p>,
    },
    {
      q: t('about.qa.how.q'),
      a: (
        <p>
          <Trans
            i18nKey="about.qa.how.a"
            components={{
              githubLink: (
                <a
                  href="https://github.com/jvacek/flamerelay"
                  className="text-amber underline-offset-2 hover:underline"
                />
              ),
            }}
          />
        </p>
      ),
    },
    {
      q: t('about.qa.who.q'),
      a: (
        <p>
          <Trans
            i18nKey="about.qa.who.a"
            components={{
              emailLink: (
                <a
                  href={emailHref}
                  className="text-amber underline-offset-2 hover:underline"
                />
              ),
              mastodonLink: (
                <a
                  href="https://fosstodon.org/@jvacek"
                  className="text-amber underline-offset-2 hover:underline"
                />
              ),
            }}
          />
        </p>
      ),
    },
    {
      q: t('about.qa.followAlong.q'),
      a: (
        <p>
          <Trans
            i18nKey="about.qa.followAlong.a"
            components={{
              instagramLink: (
                <a
                  href="https://instagram.com/lit_route"
                  className="text-amber underline-offset-2 hover:underline"
                />
              ),
              redditLink: (
                <a
                  href="https://reddit.com/r/litroute"
                  className="text-amber underline-offset-2 hover:underline"
                />
              ),
              discordLink: (
                <a
                  href="https://discord.gg/6sShax8UgF"
                  className="text-amber underline-offset-2 hover:underline"
                />
              ),
            }}
          />
        </p>
      ),
    },
    {
      q: t('about.qa.secure.q'),
      a: (
        <>
          <p>{t('about.qa.secure.a1')}</p>
          <p className="mt-2">{t('about.qa.secure.a2')}</p>
        </>
      ),
    },
    {
      q: t('about.qa.money.q'),
      a: (
        <>
          <p>{t('about.qa.money.a1')}</p>
          <p className="mt-2">{t('about.qa.money.a2')}</p>
          <p className="mt-2">{t('about.qa.money.a3')}</p>
        </>
      ),
    },
    {
      q: t('about.qa.help.q'),
      a: (
        <>
          <p>{t('about.qa.help.a1')}</p>
          <p className="mt-2">{t('about.qa.help.a2')}</p>
          <p className="mt-2">
            <Trans
              i18nKey="about.qa.help.a3"
              components={{
                weblateLink: (
                  <a
                    href={weblateUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-amber underline-offset-2 hover:underline"
                  />
                ),
              }}
            />
          </p>
        </>
      ),
    },
    {
      q: t('about.qa.translate.q'),
      a: (
        <p>
          <Trans
            i18nKey="about.qa.translate.a"
            components={{
              weblateLink: (
                <a
                  href={weblateUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-amber underline-offset-2 hover:underline"
                />
              ),
            }}
          />
        </p>
      ),
    },
  ];

  return (
    <main>
      <div className="px-6 py-12">
        <div className="mx-auto max-w-2xl">
          <header>
            <p className="font-heading mb-4 text-4xl font-bold leading-tight text-amber sm:text-5xl">
              {t('about.header')}
            </p>
            <p className="text-base leading-relaxed text-char/70">
              {t('about.subheader')}
            </p>
          </header>
        </div>
      </div>

      <div className="bg-char px-6 py-14">
        <div className="mx-auto max-w-2xl">
          <section>
            <h2 className="font-heading mb-8 text-2xl font-bold text-parchment">
              {t('about.faqTitle')}
            </h2>
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
          <section>
            <h2 className="font-heading mb-8 text-2xl font-bold text-char">
              {t('about.aboutTitle')}
            </h2>
            <div className="space-y-8">
              {aboutQa.map(({ q, a }) => (
                <QA key={q} q={q} a={a} />
              ))}
            </div>
          </section>
        </div>
      </div>

      <div className="px-6 py-14">
        <div className="mx-auto max-w-2xl">
          <section>
            <h2 className="font-heading mb-8 text-2xl font-bold text-char">
              {t('about.connect.title')}
            </h2>
            <ConnectLinks />
          </section>
        </div>
      </div>

      <SupportSection heading={t('about.supportHeading')} />

      <div className="px-6 py-14">
        <div className="mx-auto max-w-xl">
          <header className="mb-8">
            <h2 className="font-heading mb-3 text-3xl font-bold leading-tight text-amber sm:text-4xl">
              {t('feedback.embedHeading')}
            </h2>
            <p className="text-base leading-relaxed text-char/70">
              {t('feedback.embedSubheading')}
            </p>
          </header>
          <FeedbackForm />
        </div>
      </div>
    </main>
  );
}
