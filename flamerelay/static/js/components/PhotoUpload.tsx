import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { fieldErrorClass } from '../styles';

import type { ExistingImage } from './CheckinForm';

export interface NewImage {
  key: string;
  preview: string;
}

export interface PhotoUploadProps {
  newImages: NewImage[];
  existingImages: ExistingImage[];
  maxImages: number;
  onAdd: (files: File[]) => void;
  onRemoveNew: (key: string) => void;
  onRemoveExisting: (id: number) => void;
  onReorder: (newFileKeys: string[], existingIdOrder: number[]) => void;
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

function Thumbnail({
  thumbKey,
  src,
  alt,
  isDragging,
  isDropTarget,
  onRemove,
  onHandlePointerDown,
  removeLabel,
}: {
  thumbKey: string;
  src: string;
  alt: string;
  isDragging: boolean;
  isDropTarget: boolean;
  onRemove: () => void;
  onHandlePointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  removeLabel: string;
}) {
  return (
    <div
      data-item-key={thumbKey}
      className={[
        'group relative h-20 w-20 shrink-0 select-none touch-none rounded-card transition-all duration-150 cursor-grab active:cursor-grabbing',
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

      {/* Drag handle icon — visual affordance only, not the hit target */}
      <div className="pointer-events-none absolute left-1 top-1 transition-opacity duration-150 sm:opacity-0 sm:group-hover:opacity-100">
        <DragHandle className="h-4 w-4 text-white drop-shadow-sm" />
      </div>

      {/* Remove button — always visible on mobile, hover-only on desktop */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-ember text-xs text-white transition-opacity duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember sm:opacity-0 sm:group-hover:opacity-100 sm:hover:opacity-100 sm:focus-visible:opacity-100"
        aria-label={removeLabel}
      >
        &#x2715;
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
  error,
}: PhotoUploadProps) {
  const { t } = useTranslation();
  const [isDraggingZone, setIsDraggingZone] = useState(false);
  const [dragItemKey, setDragItemKey] = useState<string | null>(null);
  const [dropItemKey, setDropItemKey] = useState<string | null>(null);
  const [orderPreference, setOrderPreference] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

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
  const newMap = new Map(newImages.map((img) => [img.key, img.preview]));

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
                const src =
                  item.type === 'existing'
                    ? (existingMap.get(item.id) ?? '')
                    : (newMap.get(item.key) ?? '');
                if (!src) return null;
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
                      : 'border-amber/30 hover:border-amber/60 hover:bg-amber/5')
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
