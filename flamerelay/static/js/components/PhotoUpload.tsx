import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { fieldErrorClass } from '../styles';

import type { ExistingImage } from './CheckinForm';

export interface NewImage {
  key: string;
  preview: string;
  isShrinking?: boolean;
  shrinkFailed?: boolean;
  isUploading?: boolean;
  uploaded?: boolean;
  /** i18n key resolved by PhotoUpload; surfaced in the per-photo error popup. */
  uploadErrorMessageKey?: string;
}

export interface PhotoUploadProps {
  newImages: NewImage[];
  existingImages: ExistingImage[];
  maxImages: number;
  onAdd: (files: File[]) => void;
  onRemoveNew: (key: string) => void;
  onRemoveExisting: (id: number) => void;
  onReorder: (newFileKeys: string[], existingIdOrder: number[]) => void;
  /** Called when the user taps "Retry" on a per-photo upload error popup. */
  onRetryUpload?: (key: string) => void;
  error?: string;
}

type OrderedItem =
  | { type: 'existing'; id: number }
  | { type: 'new'; key: string };

function itemKey(item: OrderedItem): string {
  return item.type === 'existing' ? `e-${item.id}` : `n-${item.key}`;
}

const reducedMotion =
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function isExternalFileDrag(e: React.DragEvent): boolean {
  return Array.from(e.dataTransfer.types).includes('Files');
}

function CameraIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

function DragHandle({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 10 16"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <circle cx="3" cy="3" r="1.2" />
      <circle cx="7" cy="3" r="1.2" />
      <circle cx="3" cy="8" r="1.2" />
      <circle cx="7" cy="8" r="1.2" />
      <circle cx="3" cy="13" r="1.2" />
      <circle cx="7" cy="13" r="1.2" />
    </svg>
  );
}

function CloudCheckIcon({ className }: { className?: string }) {
  // Heroicons "cloud" silhouette (battle-tested path that closes cleanly
  // along its bottom edge — our earlier hand-rolled path left a notch
  // where `z` drew an unwanted vertical line back to the start point) plus
  // a white tick stroked over the center. The wrapping span supplies a
  // drop-shadow so the icon stays legible against any photo background.
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        d="M2.25 15a4.5 4.5 0 0 0 4.5 4.5H18a3.75 3.75 0 0 0 1.332-7.257 3 3 0 0 0-3.758-3.848 5.25 5.25 0 0 0-10.233 2.33A4.502 4.502 0 0 0 2.25 15z"
        fill="currentColor"
      />
      <path
        d="m9.4 14.5 2.2 2.2 4-4.5"
        fill="none"
        stroke="white"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 4.5h10" />
      <path d="M6.2 4.5V3a.7.7 0 0 1 .7-.7h2.2a.7.7 0 0 1 .7.7v1.5" />
      <path d="M4.6 4.5l.7 8.2a1 1 0 0 0 1 .9h3.4a1 1 0 0 0 1-.9l.7-8.2" />
      <path d="M7 7v4M9 7v4" />
    </svg>
  );
}

function ExclamationIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 12 12"
      className={className}
      fill="currentColor"
      aria-hidden="true"
    >
      <rect x="5.2" y="2" width="1.6" height="4.6" rx="0.5" />
      <circle cx="6" cy="9.2" r="0.9" />
    </svg>
  );
}

function Spinner({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-label={label}
      className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-card bg-black/40"
    >
      <svg
        className="h-6 w-6 animate-spin text-white"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <circle
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth={2}
          strokeOpacity={0.25}
        />
        <path
          d="M22 12a10 10 0 0 0-10-10"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

function Thumbnail({
  thumbKey,
  src,
  alt,
  isDragging,
  isDropTarget,
  isShrinking,
  shrinkFailed,
  isUploading,
  uploaded,
  uploadErrorMessage,
  shrinkingLabel,
  uploadingLabel,
  shrinkFailedLabel,
  uploadedLabel,
  uploadFailedLabel,
  retryLabel,
  errorPopupOpen,
  onToggleErrorPopup,
  onRetryUpload,
  onRemove,
  onHandlePointerDown,
  removeLabel,
}: {
  thumbKey: string;
  src: string;
  alt: string;
  isDragging: boolean;
  isDropTarget: boolean;
  isShrinking?: boolean;
  shrinkFailed?: boolean;
  isUploading?: boolean;
  uploaded?: boolean;
  uploadErrorMessage?: string;
  shrinkingLabel?: string;
  uploadingLabel?: string;
  shrinkFailedLabel?: string;
  uploadedLabel?: string;
  uploadFailedLabel?: string;
  retryLabel?: string;
  errorPopupOpen?: boolean;
  onToggleErrorPopup?: () => void;
  onRetryUpload?: () => void;
  onRemove: () => void;
  onHandlePointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  removeLabel: string;
}) {
  // Status-corner badge (top-left) is mutually exclusive: spinner during
  // shrink/upload, ✓ when done, ⚠ when upload failed. The delete button
  // lives at top-right with a distinct round red shape, so the user can't
  // confuse "remove this photo" with "this photo had an error".
  const hasUploadError = !isUploading && !!uploadErrorMessage;
  return (
    <div
      data-item-key={thumbKey}
      className={[
        'relative h-20 w-20 shrink-0 select-none touch-none rounded-card transition-all duration-150 cursor-grab active:cursor-grabbing',
        isDragging ? 'pointer-events-none scale-95 opacity-40' : '',
        isDropTarget ? 'ring-2 ring-amber ring-offset-1' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onPointerDown={onHandlePointerDown}
      onClick={(e) => e.stopPropagation()}
    >
      <img
        src={src}
        alt={alt}
        className="h-20 w-20 rounded-card object-cover"
        loading="lazy"
        draggable={false}
      />

      {isShrinking && shrinkingLabel && <Spinner label={shrinkingLabel} />}
      {!isShrinking && isUploading && uploadingLabel && (
        <Spinner label={uploadingLabel} />
      )}

      {/* Shrink-fall-back banner. Persists as long as the photo was
          uploaded at full size — useful transparency for the user. Hidden
          while shrinking is still in flight (we don't yet know if it'll
          fail), when there's an upload error (the error badge takes
          priority), and once the upload has succeeded (the cloud-check
          badge in the bottom-left would otherwise collide with it, and
          "✓ uploaded" is the more useful signal at that point). */}
      {!isShrinking &&
        shrinkFailed &&
        !hasUploadError &&
        !uploaded &&
        shrinkFailedLabel && (
          <div
            className="pointer-events-none absolute bottom-0.5 left-0.5 right-0.5 truncate rounded-full bg-ember/90 px-1.5 py-0.5 text-center text-[10px] font-medium leading-none text-white"
            title={shrinkFailedLabel}
            aria-label={shrinkFailedLabel}
          >
            {shrinkFailedLabel}
          </div>
        )}

      {/* Uploaded cloud-with-check badge. Lives in the BOTTOM-LEFT inside
          the thumbnail bounds — using a negative offset like the delete
          button would make adjacent thumbnails' badges overlap each
          other. A green cloud icon also reads as "this is on the server
          now" rather than just a generic "OK". */}
      {!isUploading && !isShrinking && uploaded && uploadedLabel && (
        <span
          className="pointer-events-none absolute bottom-1 left-1 inline-flex h-5 w-5 items-center justify-center text-moss drop-shadow"
          title={uploadedLabel}
          aria-label={uploadedLabel}
        >
          <CloudCheckIcon className="h-5 w-5" />
        </span>
      )}

      {/* Upload-failed badge: same top-LEFT slot as the checkmark (mutually
          exclusive), but on a dark "char" background with an exclamation
          glyph — different shape AND color from delete (red ✕ at right). */}
      {hasUploadError && uploadFailedLabel && (
        <button
          type="button"
          data-error-popup
          onClick={(e) => {
            e.stopPropagation();
            onToggleErrorPopup?.();
          }}
          className="absolute -left-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-md bg-char text-white shadow-sm ring-2 ring-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber"
          aria-label={uploadFailedLabel}
          aria-haspopup="dialog"
          aria-expanded={errorPopupOpen}
        >
          <ExclamationIcon className="h-3 w-3" />
        </button>
      )}

      {/* Click-to-toggle popup with the localized error + retry. Anchored
          below the thumbnail so it doesn't cover the photo itself. */}
      {hasUploadError && errorPopupOpen && (
        <div
          role="dialog"
          data-error-popup
          aria-label={uploadFailedLabel}
          onClick={(e) => e.stopPropagation()}
          className="absolute left-0 top-full z-20 mt-1 w-52 rounded-card border border-char/10 bg-white p-2.5 text-left text-xs text-char shadow-md"
        >
          <p className="mb-2 leading-snug">{uploadErrorMessage}</p>
          {onRetryUpload && retryLabel && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRetryUpload();
              }}
              className="rounded bg-amber px-2 py-1 text-xs font-medium text-white hover:bg-amber/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber"
            >
              {retryLabel}
            </button>
          )}
        </div>
      )}

      {/* Drag handle icon — visual affordance only, not the hit target.
          Suppress while a status badge is occupying the top-left slot so
          they don't collide. */}
      {!uploaded && !hasUploadError && (
        <div className="pointer-events-none absolute left-1 top-1">
          <DragHandle className="h-4 w-4 text-white drop-shadow-sm" />
        </div>
      )}

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-ember text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
        aria-label={removeLabel}
      >
        <TrashIcon className="h-3 w-3" />
      </button>
    </div>
  );
}

export default function PhotoUpload({
  newImages,
  existingImages,
  maxImages,
  onAdd,
  onRemoveNew,
  onRemoveExisting,
  onReorder,
  onRetryUpload,
  error,
}: PhotoUploadProps) {
  const { t } = useTranslation();
  const [isDraggingZone, setIsDraggingZone] = useState(false);
  const [dragItemKey, setDragItemKey] = useState<string | null>(null);
  const [dropItemKey, setDropItemKey] = useState<string | null>(null);
  const [orderPreference, setOrderPreference] = useState<string[]>([]);
  const [openErrorKey, setOpenErrorKey] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Outside-click closes any open error popup. We tag the popup AND the
  // toggle badge with `data-error-popup`; a click that isn't inside either
  // element closes the popup. Using `click` instead of `mousedown` so the
  // badge's own onClick gets to fire first and toggle the state without
  // racing against the document listener.
  useEffect(() => {
    if (!openErrorKey) return;
    function handler(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-error-popup]')) {
        setOpenErrorKey(null);
      }
    }
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [openErrorKey]);

  const orderedItems = useMemo<OrderedItem[]>(() => {
    const allItems: OrderedItem[] = [
      ...existingImages.map((img) => ({
        type: 'existing' as const,
        id: img.id,
      })),
      ...newImages.map((img) => ({ type: 'new' as const, key: img.key })),
    ];
    if (orderPreference.length === 0) return allItems;

    const byKey = new Map(allItems.map((item) => [itemKey(item), item]));
    const preferenceSet = new Set(orderPreference);
    const ordered = orderPreference
      .filter((k) => byKey.has(k))
      .map((k) => byKey.get(k)!);
    allItems.forEach((item) => {
      if (!preferenceSet.has(itemKey(item))) ordered.push(item);
    });
    return ordered;
  }, [existingImages, newImages, orderPreference]);

  const totalImages = existingImages.length + newImages.length;
  const isEmpty = totalImages === 0;
  const isFull = totalImages >= maxImages;

  const existingMap = new Map(existingImages.map((img) => [img.id, img.image]));
  const newMap = new Map(newImages.map((img) => [img.key, img]));

  // ── Reorder helper ────────────────────────────────────────────────────────

  function commitReorder(fromKey: string, toKey: string) {
    if (fromKey === toKey) return;
    const next = [...orderedItems];
    const fromIdx = next.findIndex((item) => itemKey(item) === fromKey);
    const toIdx = next.findIndex((item) => itemKey(item) === toKey);
    if (fromIdx === -1 || toIdx === -1) return;
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    setOrderPreference(next.map(itemKey));
    onReorder(
      next
        .filter((i) => i.type === 'new')
        .map((i) => (i as { key: string }).key),
      next
        .filter((i) => i.type === 'existing')
        .map((i) => (i as { id: number }).id),
    );
  }

  // ── Pointer-based reorder (works on mouse and touch) ─────────────────────

  function handleHandlePointerDown(
    e: React.PointerEvent<HTMLDivElement>,
    key: string,
  ) {
    // Don't start a drag if the pointer-down originated on an interactive
    // child (e.g. the remove button) — let the click reach it.
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragItemKey(key);
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!dragItemKey) return;
    // elementsFromPoint skips the dragged thumb (pointer-events-none) and returns what's under it
    const els = document.elementsFromPoint(e.clientX, e.clientY);
    for (const el of els) {
      const k = (el as HTMLElement)
        .closest('[data-item-key]')
        ?.getAttribute('data-item-key');
      if (k && k !== dragItemKey) {
        setDropItemKey(k);
        return;
      }
    }
    setDropItemKey(null);
  }

  function handlePointerUp() {
    if (dragItemKey && dropItemKey) commitReorder(dragItemKey, dropItemKey);
    setDragItemKey(null);
    setDropItemKey(null);
  }

  // ── Zone drag (external file drop from OS) ────────────────────────────────

  function handleZoneDragEnter(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!isFull && isExternalFileDrag(e)) setIsDraggingZone(true);
  }

  function handleZoneDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!isFull && isExternalFileDrag(e)) setIsDraggingZone(true);
  }

  function handleZoneDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!e.currentTarget.contains(e.relatedTarget as Node))
      setIsDraggingZone(false);
  }

  function handleZoneDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingZone(false);
    if (isFull || !isExternalFileDrag(e)) return;
    const files = Array.from(e.dataTransfer.files);
    if (files.length) onAdd(files);
  }

  // ── Zone click / keyboard ─────────────────────────────────────────────────

  function handleZoneClick() {
    if (!isFull && !dragItemKey) inputRef.current?.click();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!isFull) inputRef.current?.click();
    }
  }

  // ── Zone classes ──────────────────────────────────────────────────────────

  const zoneBase =
    'relative w-full rounded-card border-2 ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber focus-visible:ring-offset-2';

  const zoneVariant = isFull
    ? 'border-dashed border-smoke/20 bg-linen/50 cursor-default p-4'
    : isDraggingZone
      ? 'border-solid border-amber bg-amber/15 cursor-copy p-4'
      : isEmpty
        ? 'border-dashed border-amber/40 bg-amber/5 cursor-pointer min-h-[160px] sm:min-h-[200px]'
        : 'border-dashed border-amber/30 bg-amber/5 cursor-pointer p-4';

  return (
    <div
      className="rounded-card border border-char/10 bg-white p-4 shadow-card"
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {/* Label row */}
      <div className="mb-2 flex items-center justify-between">
        <label className="block text-sm font-medium text-char">
          {t('photoUpload.label')}
          <span className="ml-1 text-xs font-normal text-smoke">
            {t('photoUpload.optional')}
          </span>
        </label>
        <span
          className={
            'rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums ' +
            (isFull ? 'bg-smoke/10 text-smoke' : 'bg-amber/15 text-amber')
          }
        >
          {t('photoUpload.counter', { count: totalImages, max: maxImages })}
        </span>
      </div>

      {/* Drop zone */}
      <div
        role="button"
        tabIndex={isFull ? -1 : 0}
        aria-label={
          isFull ? t('photoUpload.zoneAriaFull') : t('photoUpload.zoneAriaAdd')
        }
        className={`${zoneBase} ${zoneVariant}`}
        onClick={handleZoneClick}
        onKeyDown={handleKeyDown}
        onDragEnter={handleZoneDragEnter}
        onDragOver={handleZoneDragOver}
        onDragLeave={handleZoneDragLeave}
        onDrop={handleZoneDrop}
        style={{
          transform:
            isDraggingZone && !reducedMotion ? 'scale(1.015)' : 'scale(1)',
          transition: reducedMotion
            ? 'none'
            : 'transform 150ms ease, border-color 200ms ease, background-color 200ms ease',
        }}
      >
        {/* Empty state */}
        {isEmpty && (
          <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
            <div
              className={
                'rounded-full p-3 transition-colors duration-200 ' +
                (isDraggingZone ? 'bg-amber/20' : 'bg-amber/10')
              }
            >
              <CameraIcon
                className={
                  'h-7 w-7 transition-colors duration-200 ' +
                  (isDraggingZone ? 'text-amber' : 'text-amber/60')
                }
              />
            </div>
            <div>
              <p className="font-heading text-lg font-semibold text-char">
                {isDraggingZone
                  ? t('photoUpload.empty.dropHere')
                  : t('photoUpload.empty.addPhotos')}
              </p>
              <p className="mt-0.5 text-xs text-smoke">
                {isDraggingZone
                  ? t('photoUpload.empty.releaseToUpload')
                  : t('photoUpload.empty.showWhere', { max: maxImages })}
              </p>
            </div>
            {!isDraggingZone && (
              <span className="text-xs text-amber/70">
                {t('photoUpload.empty.clickOrDrag')}
              </span>
            )}
          </div>
        )}

        {/* Has-photos state */}
        {!isEmpty && (
          <>
            <div className="flex flex-wrap gap-2">
              {orderedItems.map((item) => {
                const key = itemKey(item);
                const newImg =
                  item.type === 'new' ? newMap.get(item.key) : null;
                const src =
                  item.type === 'existing'
                    ? (existingMap.get(item.id) ?? '')
                    : (newImg?.preview ?? '');
                if (!src) return null;
                const uploadErrorMessage = newImg?.uploadErrorMessageKey
                  ? t(newImg.uploadErrorMessageKey)
                  : undefined;
                return (
                  <Thumbnail
                    key={key}
                    thumbKey={key}
                    src={src}
                    alt={
                      item.type === 'existing'
                        ? t('photoUpload.existingPhoto')
                        : t('photoUpload.preview')
                    }
                    isDragging={dragItemKey === key}
                    isDropTarget={dropItemKey === key}
                    isShrinking={newImg?.isShrinking}
                    shrinkFailed={newImg?.shrinkFailed}
                    isUploading={newImg?.isUploading}
                    uploaded={newImg?.uploaded}
                    uploadErrorMessage={uploadErrorMessage}
                    shrinkingLabel={t('photoUpload.shrinking')}
                    uploadingLabel={t('photoUpload.uploading')}
                    shrinkFailedLabel={t('photoUpload.shrinkFailed')}
                    uploadedLabel={t('photoUpload.uploaded')}
                    uploadFailedLabel={t('photoUpload.uploadFailed')}
                    retryLabel={t('photoUpload.retry')}
                    errorPopupOpen={
                      item.type === 'new' && openErrorKey === item.key
                    }
                    onToggleErrorPopup={
                      item.type === 'new'
                        ? () =>
                            setOpenErrorKey((curr) =>
                              curr === item.key ? null : item.key,
                            )
                        : undefined
                    }
                    onRetryUpload={
                      item.type === 'new' && onRetryUpload
                        ? () => {
                            setOpenErrorKey(null);
                            onRetryUpload(item.key);
                          }
                        : undefined
                    }
                    onRemove={() =>
                      item.type === 'existing'
                        ? onRemoveExisting(item.id)
                        : onRemoveNew(item.key)
                    }
                    onHandlePointerDown={(e) => handleHandlePointerDown(e, key)}
                    removeLabel={t('photoUpload.removePhoto')}
                  />
                );
              })}
              {!isFull && (
                <div
                  className={
                    'flex h-20 w-20 items-center justify-center rounded-card border-2 border-dashed transition-colors duration-200 ' +
                    (isDraggingZone
                      ? 'border-amber bg-amber/20'
                      : 'border-amber/30')
                  }
                >
                  <span className="text-xl font-light text-amber/50">+</span>
                </div>
              )}
            </div>

            {isFull ? (
              <p className="mt-2 text-xs text-smoke">
                {t('photoUpload.maxReached', { max: maxImages })}
              </p>
            ) : (
              <p className="mt-2 text-xs text-smoke/70">
                {t('photoUpload.dragToReorder')}
              </p>
            )}
          </>
        )}
      </div>

      {/* Hidden file input */}
      <input
        ref={inputRef}
        id="images"
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp,image/bmp,image/tiff,image/heic,image/heif"
        multiple
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) onAdd(files);
          e.target.value = '';
        }}
      />

      {/* Photo tips */}
      <div className="mt-3 rounded-card border border-amber/20 bg-amber/5 px-4 py-3">
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-char/70">
          {t('photoUpload.tips.heading')}
        </p>
        <ul className="space-y-1 text-xs text-char/60">
          <li>📍 {t('photoUpload.tips.location')}</li>
          <li>🔥 {t('photoUpload.tips.lighter')}</li>
          <li>🙈 {t('photoUpload.tips.hide')}</li>
        </ul>
      </div>

      {/* Error */}
      {error && (
        <p className={fieldErrorClass} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
