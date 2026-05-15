import { useTranslation } from 'react-i18next';
import { outlineBtnMd, primaryBtnMd } from '../styles';

interface Props {
  onRetry: () => void;
  onDismiss: () => void;
}

export default function LowPrecisionLocationModal({
  onRetry,
  onDismiss,
}: Props) {
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
          {t('checkin.form.gpsLowPrecisionModal.title')}
        </h2>
        <p className="mb-6 text-sm leading-relaxed text-char/80">
          {t('checkin.form.gpsLowPrecisionModal.body')}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button type="button" className={outlineBtnMd} onClick={onRetry}>
            {t('checkin.form.gpsLowPrecisionModal.tryAgain')}
          </button>
          <button type="button" className={primaryBtnMd} onClick={onDismiss}>
            {t('checkin.form.gpsLowPrecisionModal.useAnyway')}
          </button>
        </div>
      </div>
    </div>
  );
}
