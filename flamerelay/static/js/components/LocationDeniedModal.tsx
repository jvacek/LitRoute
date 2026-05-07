import { Trans, useTranslation } from 'react-i18next';
import { outlineBtnMd, primaryBtnMd } from '../styles';

interface Props {
  onRetry: () => void;
  onDismiss: () => void;
}

export default function LocationDeniedModal({ onRetry, onDismiss }: Props) {
  const { t } = useTranslation();

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onDismiss}
    >
      <div
        className="w-full max-w-md rounded-card bg-parchment p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-heading mb-2 text-xl font-bold text-char">
          {t('checkin.form.gpsDeniedModal.title')}
        </h2>
        <p className="mb-4 text-sm leading-relaxed text-char/80">
          {t('checkin.form.gpsDeniedModal.body')}
        </p>
        <ol className="mb-6 list-decimal space-y-2 pl-5 text-sm text-char/80">
          <li>
            <Trans
              i18nKey="checkin.form.gpsDeniedModal.step1"
              components={{ strong: <strong className="text-char" /> }}
            />
          </li>
          <li>
            <Trans
              i18nKey="checkin.form.gpsDeniedModal.step2"
              components={{ strong: <strong className="text-char" /> }}
            />
          </li>
          <li>{t('checkin.form.gpsDeniedModal.step3')}</li>
        </ol>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button type="button" className={outlineBtnMd} onClick={onDismiss}>
            {t('checkin.form.gpsDeniedModal.close')}
          </button>
          <button type="button" className={primaryBtnMd} onClick={onRetry}>
            {t('checkin.form.gpsDeniedModal.tryAgain')}
          </button>
        </div>
      </div>
    </div>
  );
}
