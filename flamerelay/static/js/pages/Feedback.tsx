import { useTranslation } from 'react-i18next';
import FeedbackForm from '../components/FeedbackForm';

export default function Feedback() {
  const { t } = useTranslation();

  return (
    <main>
      <div className="px-6 py-12">
        <div className="mx-auto max-w-xl">
          <header className="mb-8">
            <h1 className="font-heading mb-3 text-4xl font-bold leading-tight text-amber sm:text-5xl">
              {t('feedback.title')}
            </h1>
            <p className="text-base leading-relaxed text-char/70">
              {t('feedback.subtitle')}
            </p>
          </header>

          <FeedbackForm />
        </div>
      </div>
    </main>
  );
}
