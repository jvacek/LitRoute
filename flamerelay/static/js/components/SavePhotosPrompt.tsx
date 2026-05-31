import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { reportError } from '../lib/sentry';

export interface SavePhotosPromptProps {
  /** Full-resolution originals of photos taken with the in-page camera this
   * session (see `lib/freshCapture.ts`). Pre-downscale, so saving these gives
   * the user the untouched shot rather than the 2560px JPEG we upload. */
  files: File[];
}

function canShareFiles(files: File[]): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.canShare === 'function' &&
    files.length > 0 &&
    navigator.canShare({ files })
  );
}

/**
 * Offers to save freshly-captured photos back to the user's device before they
 * post a check-in. On iOS a photo shot through a web file input is never
 * written to the camera roll, so without this the only copy lives in the page
 * and is lost on submit.
 *
 * Renders only where the Web Share API can share files (`navigator.canShare`
 * with a `files` payload — iOS Safari, Android Chrome), since that native
 * share sheet is the one web path that can reach the camera roll. Elsewhere
 * (desktop, where there's no in-page camera anyway) it renders nothing.
 */
export default function SavePhotosPrompt({ files }: SavePhotosPromptProps) {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(false);

  const shareSupported = useMemo(() => canShareFiles(files), [files]);

  if (!shareSupported || dismissed) return null;

  async function handleShare() {
    try {
      await navigator.share({ files });
    } catch (err) {
      // The user dismissing the native share sheet rejects with AbortError —
      // that's a normal cancel, not a bug worth reporting.
      if (err instanceof DOMException && err.name === 'AbortError') return;
      reportError(err, { where: 'SavePhotosPrompt.share' });
    }
  }

  return (
    <div className="rounded-card border border-amber/40 bg-amber/10 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm font-medium text-char">
            {t('savePhotos.title', { count: files.length })}
          </p>
          <p className="text-sm text-char/80">{t('savePhotos.body')}</p>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="mt-0.5 shrink-0 p-1 text-smoke hover:text-char"
          aria-label={t('savePhotos.dismiss')}
        >
          &#x2715;
        </button>
      </div>

      <button
        type="button"
        onClick={handleShare}
        className="mt-2 rounded-btn bg-amber px-3 py-1.5 text-sm font-medium tracking-wide text-white hover:-translate-y-px active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber"
      >
        {t('savePhotos.save', { count: files.length })}
      </button>
    </div>
  );
}
