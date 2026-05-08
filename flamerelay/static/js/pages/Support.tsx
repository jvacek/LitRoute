import { useTranslation } from 'react-i18next';
import FeedbackForm from '../components/FeedbackForm';
import SupportSection from '../components/SupportSection';

export default function Support() {
  const { t } = useTranslation();
  return (
    <main>
      <div className="px-6 py-12">
        <div className="mx-auto max-w-2xl">
          <header>
            <p className="font-heading mb-4 text-4xl font-bold leading-tight text-amber sm:text-5xl">
              {t('support.header')}
            </p>
            <p className="text-base leading-relaxed text-char/70">
              {t('support.subheader')}
            </p>
          </header>
        </div>
      </div>

      <SupportSection />

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
