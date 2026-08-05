import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { amberCharBtnLg } from '../styles';

interface ErrorPageProps {
  code: number;
  exception?: string;
  csrf?: boolean;
}

function FlameIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 36"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path d="M12 0C12 0 4 10 4 20C4 28 7.5 34 12 36C16.5 34 20 28 20 20C20 10 12 0 12 0ZM12 30C9.8 27.5 8.5 24.5 8.5 21C8.5 17.5 10.5 14.5 12 12.5C13.5 14.5 15.5 17.5 15.5 21C15.5 24.5 14.2 27.5 12 30Z" />
    </svg>
  );
}

export default function ErrorPage({
  code,
  exception,
  csrf = false,
}: ErrorPageProps) {
  const { t } = useTranslation();

  let headline: string;
  let description: string;
  let color: 'amber' | 'ember';
  if (code === 404) {
    headline = t('errorPage.404.headline');
    description = t('errorPage.404.description');
    color = 'amber';
  } else if (code === 403 && csrf) {
    headline = t('errorPage.403csrf.headline');
    description = t('errorPage.403csrf.description');
    color = 'ember';
  } else if (code === 403) {
    headline = t('errorPage.403.headline');
    description = t('errorPage.403.description');
    color = 'ember';
  } else {
    headline = t('errorPage.500.headline');
    description = t('errorPage.500.description');
    color = 'ember';
  }
  const iconColor = color === 'amber' ? 'text-amber' : 'text-ember';

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center py-16 text-center">
      <FlameIcon className={`mb-4 h-12 w-12 ${iconColor}`} />
      <p className="select-none font-heading text-[8rem] font-bold leading-none text-char/10">
        {code}
      </p>
      <h1 className="mt-2 font-heading text-3xl font-semibold text-char">
        {headline}
      </h1>
      <p className="mt-3 max-w-sm text-smoke">{exception || description}</p>
      <Link to="/" className={`mt-8 ${amberCharBtnLg}`}>
        {t('errorPage.backToHome')}
      </Link>
    </div>
  );
}
