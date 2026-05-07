import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';

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

export default function Countdown({ endTime }: Props) {
  const { t } = useTranslation();
  const targetMs = new Date(endTime).getTime();
  const [parts, setParts] = useState<Parts>(() => diff(targetMs));

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
    return (
      <div className="rounded-card border border-char/10 bg-parchment px-5 py-4 text-center">
        <div className="font-heading text-2xl font-bold text-ember">
          {t('game.countdown.ended')}
        </div>
        <div className="mt-1 text-xs uppercase tracking-wide text-char/60">
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
