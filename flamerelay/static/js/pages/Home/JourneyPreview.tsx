import type { CSSProperties } from 'react';
import { Fragment, useEffect, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import arrowZSrc from '../../assets/arrows/arrow-z.svg';
import hArrow1Src from '../../assets/arrows/h-arrow-1.svg';
import hArrow2Src from '../../assets/arrows/h-arrow-2.svg';
import hArrow3Src from '../../assets/arrows/h-arrow-3.svg';
import berlinImg from '../../assets/journey/berlin.webp';
import lisbonImg from '../../assets/journey/lisbon.webp';
import brusselsImg from '../../assets/journey/brussels.webp';

const JOURNEY_STOPS = [
  {
    location: 'Bar in Lisbon',
    name: 'Miguel',
    nameRotate: '-2deg',
    quote: 'Found this under a barstool. Leaving it for the next person.',
    img: lisbonImg,
    tilt: 'rotate(-2.5deg) translateY(-8px)',
  },
  {
    location: 'Airbnb in Berlin',
    name: 'Sophie',
    nameRotate: '-1deg',
    quote: 'A guest left this. Adding my stop before I fly home to Tokyo.',
    img: berlinImg,
    tilt: 'rotate(1.5deg) translateY(14px)',
  },
  {
    location: 'Coffee shop in Brussels',
    name: 'Alex',
    nameRotate: '-3deg',
    quote: 'Came all the way from Europe? Had to check in.',
    img: brusselsImg,
    tilt: 'rotate(-1deg) translateY(-4px)',
  },
];

function HArrow({ src }: { src: string }) {
  return (
    <div className="w-10 shrink-0" aria-hidden="true">
      <img src={src} alt="" className="w-full" />
    </div>
  );
}

function ZConnector({ src }: { src: string }) {
  return (
    <div className="w-full" aria-hidden="true">
      <img src={src} alt="" className="w-full" />
    </div>
  );
}

export function JourneyPreview() {
  const { t } = useTranslation();
  const sectionRef = useRef<HTMLElement>(null);
  const mobileSectionRef = useRef<HTMLDivElement>(null);
  const [sectionVisible, setSectionVisible] = useState(false);
  const [visibleCards, setVisibleCards] = useState<Set<number>>(new Set());
  const reducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    const isDesktop = window.matchMedia('(min-width: 1024px)').matches;

    if (isDesktop) {
      const el = sectionRef.current;
      if (!el) return;
      const obs = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            setSectionVisible(true);
            obs.disconnect();
          }
        },
        { threshold: 0.2 },
      );
      obs.observe(el);
      return () => obs.disconnect();
    }

    // Mobile: observe each card individually — only show when fully in view
    const observers: IntersectionObserver[] = [];
    const cards =
      mobileSectionRef.current?.querySelectorAll<HTMLDivElement>(
        '[data-mobile-card]',
      );
    cards?.forEach((el, i) => {
      const obs = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            setVisibleCards((prev) => new Set([...prev, i]));
            obs.disconnect();
          }
        },
        { threshold: 0.9 },
      );
      obs.observe(el);
      observers.push(obs);
    });
    return () => observers.forEach((o) => o.disconnect());
  }, []);

  const isCardVisible = (i: number) => sectionVisible || visibleCards.has(i);

  const cardClass = (i: number) => {
    if (isCardVisible(i)) return reducedMotion ? '' : 'journey-card';
    return 'opacity-0';
  };

  const cardStyle = (i: number): CSSProperties | undefined => {
    if (!isCardVisible(i) || reducedMotion) return undefined;
    // Desktop stagger; mobile cards appear immediately (scroll provides natural stagger)
    if (sectionVisible) return { animationDelay: `${i * 300}ms` };
    return undefined;
  };

  const renderCard = (
    stop: (typeof JOURNEY_STOPS)[0],
    i: number,
    isMobile?: boolean,
  ) => (
    <div
      data-mobile-card={isMobile ? 'true' : undefined}
      className={`no-glow ${cardClass(i)} overflow-hidden rounded-card bg-linen shadow-card`}
      style={cardStyle(i)}
    >
      <img
        src={stop.img}
        alt=""
        aria-hidden="true"
        loading="lazy"
        className="aspect-[3/4] w-full object-cover"
      />
      <div className="p-5">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-smoke/70">
          {stop.location}
        </p>
        <p className="mb-3 text-xs leading-relaxed text-char/60">
          &ldquo;{stop.quote}&rdquo;
        </p>
        <div className="flex justify-end">
          <span
            className="font-handwriting inline-block text-2xl text-char/80"
            style={{ transform: `rotate(${stop.nameRotate})` }}
          >
            {stop.name}
          </span>
        </div>
      </div>
    </div>
  );

  const handleOpenSlotClick = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(
      () => document.dispatchEvent(new CustomEvent('lighter-pop')),
      400,
    );
  };

  const renderOpenSlot = (isMobile?: boolean) => (
    <div
      data-mobile-card={isMobile ? 'true' : undefined}
      onClick={handleOpenSlotClick}
      className={`no-glow ${cardClass(3)} cursor-pointer overflow-hidden rounded-card border-2 border-dashed border-amber/30 bg-linen shadow-card transition-colors hover:border-amber/60`}
      style={cardStyle(3)}
    >
      <div className="flex aspect-[3/4] w-full items-center justify-center bg-amber/5">
        <span className="font-heading text-5xl font-bold text-amber/20">?</span>
      </div>
      <div className="p-5">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-smoke/40">
          {t('home.journey.somewhere')}
        </p>
        <p className="mb-3 text-xs leading-relaxed text-char/35">
          {t('home.journey.openSlotBody')}
        </p>
        <div className="flex justify-end">
          <span className="font-handwriting inline-block text-2xl text-amber/40">
            {t('home.journey.yourName')}
          </span>
        </div>
      </div>
    </div>
  );

  return (
    <section
      ref={sectionRef}
      className="parchment-glow overflow-hidden px-6 py-20"
    >
      <div className="mx-auto max-w-5xl">
        <p className="mb-2 text-center text-sm font-medium uppercase tracking-widest text-smoke/60">
          {t('home.journey.exampleLabel')}
        </p>
        <h2 className="font-heading mb-3 text-center text-2xl font-bold text-char sm:text-3xl">
          {t('home.journey.heading')}
        </h2>
        <p className="mb-8 text-center text-xs italic text-smoke/50">
          {t('home.journey.subtext')}
        </p>

        {/* Desktop: flex row, arrows sit between cards in the gap */}
        <div className="hidden items-center py-6 lg:flex">
          {JOURNEY_STOPS.map((stop, i) => (
            <Fragment key={stop.location}>
              <div
                className="flex-1"
                style={{ transform: reducedMotion ? undefined : stop.tilt }}
              >
                {renderCard(stop, i)}
              </div>
              <HArrow src={[hArrow1Src, hArrow2Src, hArrow3Src][i]} />
            </Fragment>
          ))}
          <div
            className="flex-1"
            style={{
              transform: reducedMotion
                ? undefined
                : 'rotate(2.5deg) translateY(10px)',
            }}
          >
            {renderOpenSlot()}
          </div>
        </div>

        {/* Mobile: two flex rows with arrows, Z-connector between rows */}
        <div ref={mobileSectionRef} className="py-6 lg:hidden">
          <div className="flex items-center">
            <div
              className="min-w-0 flex-1"
              style={{
                transform: reducedMotion ? undefined : JOURNEY_STOPS[0].tilt,
              }}
            >
              {renderCard(JOURNEY_STOPS[0], 0, true)}
            </div>
            <HArrow src={hArrow1Src} />
            <div
              className="min-w-0 flex-1"
              style={{
                transform: reducedMotion ? undefined : JOURNEY_STOPS[1].tilt,
              }}
            >
              {renderCard(JOURNEY_STOPS[1], 1, true)}
            </div>
          </div>
          <ZConnector src={arrowZSrc} />
          <div className="flex items-center">
            <div
              className="min-w-0 flex-1"
              style={{
                transform: reducedMotion ? undefined : JOURNEY_STOPS[2].tilt,
              }}
            >
              {renderCard(JOURNEY_STOPS[2], 2, true)}
            </div>
            <HArrow src={hArrow2Src} />
            <div
              className="min-w-0 flex-1"
              style={{
                transform: reducedMotion
                  ? undefined
                  : 'rotate(2.5deg) translateY(10px)',
              }}
            >
              {renderOpenSlot(true)}
            </div>
          </div>
        </div>

        <p className="mt-4 text-center text-sm text-smoke">
          <Trans
            i18nKey="home.journey.seeReal"
            components={{
              journeyLink: (
                <Link
                  to="/unit/john-93"
                  className="font-medium text-amber underline-offset-2 hover:underline"
                />
              ),
            }}
          />
        </p>
      </div>
    </section>
  );
}
