import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { components } from '../api/schema';

interface ImageCarouselProps {
  images: components['schemas']['CheckInImage'][];
  onImageClick: (url: string) => void;
}

export default function ImageCarousel({
  images,
  onImageClick,
}: ImageCarouselProps) {
  const { t } = useTranslation();
  const [index, setIndex] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);

  function scrollTo(i: number) {
    if (!trackRef.current) return;
    trackRef.current.scrollTo({
      left: i * trackRef.current.clientWidth,
      behavior: 'smooth',
    });
  }

  function handleScroll() {
    if (!trackRef.current) return;
    const i = Math.round(
      trackRef.current.scrollLeft / trackRef.current.clientWidth,
    );
    setIndex(Math.max(0, Math.min(i, images.length - 1)));
  }

  if (images.length === 0) return null;

  return (
    <div className="relative h-full w-full select-none">
      {/* Scrollable track — native snap scrolling */}
      <div
        ref={trackRef}
        onScroll={handleScroll}
        className="flex h-full snap-x snap-mandatory overflow-x-auto [&::-webkit-scrollbar]:hidden"
        style={{ scrollbarWidth: 'none' } as React.CSSProperties}
      >
        {images.map((img, i) => (
          <div
            key={img.id}
            className="h-full w-full flex-shrink-0 snap-start cursor-zoom-in"
            onClick={() => onImageClick(img.image)}
          >
            <img
              src={img.image}
              alt={t('unit.photoAlt', { index: i + 1, total: images.length })}
              loading={i === 0 ? 'eager' : 'lazy'}
              decoding="async"
              className="h-full w-full object-cover"
              draggable={false}
            />
          </div>
        ))}
      </div>

      {images.length > 1 && (
        <>
          {/* 1/n badge */}
          <span className="pointer-events-none absolute right-2 top-2 rounded-full bg-black/50 px-2 py-0.5 text-xs text-white">
            {index + 1}/{images.length}
          </span>

          {/* Prev/Next buttons — desktop only */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              scrollTo((index - 1 + images.length) % images.length);
            }}
            className="absolute left-1 top-1/2 hidden -translate-y-1/2 items-center justify-center rounded-full bg-black/40 p-1 text-white hover:bg-black/60 sm:flex"
            aria-label={t('unit.prevPhoto')}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path
                d="M10 3L5 8l5 5"
                stroke="currentColor"
                strokeWidth="2"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              scrollTo((index + 1) % images.length);
            }}
            className="absolute right-1 top-1/2 hidden -translate-y-1/2 items-center justify-center rounded-full bg-black/40 p-1 text-white hover:bg-black/60 sm:flex"
            aria-label={t('unit.nextPhoto')}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path
                d="M6 3l5 5-5 5"
                stroke="currentColor"
                strokeWidth="2"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          {/* Dot indicators */}
          <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1 rounded-full bg-black/40 px-2 py-1">
            {images.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  scrollTo(i);
                }}
                className={`h-1.5 w-1.5 rounded-full transition-colors ${i === index ? 'bg-white' : 'bg-white/50'}`}
                aria-label={t('unit.goToPhoto', { index: i + 1 })}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
