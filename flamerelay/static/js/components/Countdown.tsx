import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import { brandColors } from '../lib/brandColors';

interface Props {
  endTime: string; // ISO datetime
}

interface Parts {
  expired: boolean;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

function diff(targetMs: number): Parts {
  const total = targetMs - Date.now();
  if (total <= 0) {
    return { expired: true, days: 0, hours: 0, minutes: 0, seconds: 0 };
  }
  const seconds = Math.floor(total / 1000) % 60;
  const minutes = Math.floor(total / (1000 * 60)) % 60;
  const hours = Math.floor(total / (1000 * 60 * 60)) % 24;
  const days = Math.floor(total / (1000 * 60 * 60 * 24));
  return { expired: false, days, hours, minutes, seconds };
}

const CONFETTI_COLORS = [
  brandColors.amber,
  brandColors.ember,
  brandColors.moss,
  brandColors.smoke,
  brandColors.blueprint,
];
const PARTICLES_PER_EMITTER = 14;

interface Particle {
  dx: number;
  peakY: number;
  fallY: number;
  rot: number;
  delay: number;
  duration: number;
  color: string;
  width: number;
  height: number;
}

// Build a fan of particles for one corner. `direction` is +1 for the
// left emitter (particles fly right) and -1 for the right emitter.
// Launch angle is ~30° above horizontal — the trajectory waypoint at the
// keyframe peak is (dx/2, peakY), so peakY = (dx/2) * tan(30°) ≈ dx*0.289.
// A small per-particle jitter keeps the fan from looking mechanical.
const TAN_30 = Math.tan((30 * Math.PI) / 180);

function buildParticles(direction: 1 | -1): Particle[] {
  return Array.from({ length: PARTICLES_PER_EMITTER }, () => {
    const spread = 220 + Math.random() * 260; // 220–480px inward
    const angleJitter = 0.85 + Math.random() * 0.3; // ±15% angle variation
    const peak = -(spread / 2) * TAN_30 * angleJitter;
    const fall = 60 + Math.random() * 140; // 60–200px below origin
    return {
      dx: direction * spread,
      peakY: peak,
      fallY: fall,
      rot: (Math.random() * 720 - 360) * direction,
      delay: Math.random() * 0.35,
      duration: 1.8 + Math.random() * 0.9,
      color:
        CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
      width: 6 + Math.random() * 4,
      height: 10 + Math.random() * 6,
    };
  });
}

export default function Countdown({ endTime }: Props) {
  const { t } = useTranslation();
  const targetMs = new Date(endTime).getTime();
  const [parts, setParts] = useState<Parts>(() => diff(targetMs));
  // Generated once per mount so the burst plays exactly when the celebration
  // card appears, and the random scatter is stable across re-renders.
  const leftParticles = useMemo(() => buildParticles(1), []);
  const rightParticles = useMemo(() => buildParticles(-1), []);

  useEffect(() => {
    const id = setInterval(() => setParts(diff(targetMs)), 1000);
    return () => clearInterval(id);
  }, [targetMs]);

  const endDate = new Date(endTime).toLocaleDateString(i18n.resolvedLanguage, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  if (parts.expired) {
    // The animations are CSS-keyframe based and play on mount. Whether the
    // user loaded into the expired state directly or watched the timer flip
    // here mid-session, this branch mounts fresh and the animation fires.
    return (
      <div className="celebration-card relative overflow-hidden rounded-card border border-amber/40 bg-gradient-to-br from-parchment to-amber/10 px-5 py-6 text-center">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
        >
          <div className="confetti-emitter left">
            {leftParticles.map((p, i) => (
              <span
                key={`l-${i}`}
                className="confetti-particle"
                style={
                  {
                    '--dx': `${p.dx}px`,
                    '--peak-y': `${p.peakY}px`,
                    '--fall-y': `${p.fallY}px`,
                    '--rot': `${p.rot}deg`,
                    animationDelay: `${p.delay}s`,
                    animationDuration: `${p.duration}s`,
                    backgroundColor: p.color,
                    width: `${p.width}px`,
                    height: `${p.height}px`,
                  } as CSSProperties
                }
              />
            ))}
          </div>
          <div className="confetti-emitter right">
            {rightParticles.map((p, i) => (
              <span
                key={`r-${i}`}
                className="confetti-particle"
                style={
                  {
                    '--dx': `${p.dx}px`,
                    '--peak-y': `${p.peakY}px`,
                    '--fall-y': `${p.fallY}px`,
                    '--rot': `${p.rot}deg`,
                    animationDelay: `${p.delay}s`,
                    animationDuration: `${p.duration}s`,
                    backgroundColor: p.color,
                    width: `${p.width}px`,
                    height: `${p.height}px`,
                  } as CSSProperties
                }
              />
            ))}
          </div>
        </div>
        <div className="font-heading celebration-headline relative text-2xl font-bold text-amber">
          🎉 {t('game.countdown.ended')}
        </div>
        <div className="relative mt-1 text-xs uppercase tracking-wide text-char/60">
          {t('game.countdown.endedOn', { date: endDate })}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-card border border-char/10 bg-parchment px-5 py-4 text-center">
      <div className="text-xs uppercase tracking-wide text-char/60">
        {t('game.countdown.endsIn')}
      </div>
      <div className="mt-2 flex items-baseline justify-center gap-3 sm:gap-5">
        <Cell value={parts.days} label={t('game.countdown.days')} />
        <Cell value={parts.hours} label={t('game.countdown.hours')} />
        <Cell value={parts.minutes} label={t('game.countdown.minutes')} />
        <Cell value={parts.seconds} label={t('game.countdown.seconds')} />
      </div>
      <div className="mt-2 text-xs uppercase tracking-wide text-char/60">
        {t('game.countdown.endsOn', { date: endDate })}
      </div>
    </div>
  );
}

const DIGIT_STRIP = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

function Digit({ value }: { value: number }) {
  return (
    <span
      aria-hidden="true"
      className="relative inline-block overflow-hidden align-top tabular-nums"
      style={{ height: '1em', lineHeight: 1 }}
    >
      <span
        className="block transition-transform duration-500 ease-out motion-reduce:transition-none"
        style={{ transform: `translateY(-${value}em)` }}
      >
        {DIGIT_STRIP.map((d) => (
          <span
            key={d}
            className="block"
            style={{ height: '1em', lineHeight: 1 }}
          >
            {d}
          </span>
        ))}
      </span>
    </span>
  );
}

function Cell({ value, label }: { value: number; label: string }) {
  const digits = String(value).padStart(2, '0').split('');
  return (
    <div>
      <div
        className="font-heading text-3xl font-bold text-char sm:text-4xl"
        // Visible label for screen readers; the rolling digits are aria-hidden
        // so the numeric value isn't read out as ten copies of itself.
        aria-label={`${value} ${label}`}
      >
        {digits.map((d, i) => (
          <Digit key={i} value={parseInt(d, 10)} />
        ))}
      </div>
      <div
        aria-hidden="true"
        className="mt-0.5 text-[10px] uppercase tracking-wide text-char/60"
      >
        {label}
      </div>
    </div>
  );
}
