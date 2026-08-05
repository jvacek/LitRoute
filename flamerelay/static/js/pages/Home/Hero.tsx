import { useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';

import { apiFetch } from '../../api';
import scribbleUpSrc from '../../assets/arrows/scribble-up.svg';
import BetaBanner from '../../components/BetaBanner';
import LighterInput from './LighterInput';

const IDENTIFIER_RE = /^\w{3,}-\d{2,}$/;

interface FormatError {
  message: string;
  example: string | null;
}

function LighterName({ id }: { id: string }) {
  return (
    <span className="font-handwriting uppercase text-base text-amber">
      {id}
    </span>
  );
}

export function Hero() {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const [inputError, setInputError] = useState<FormatError | null>(null);
  const [notFoundId, setNotFoundId] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [errorKey, setErrorKey] = useState(0);

  function formatError(id: string): FormatError {
    const dashIdx = id.indexOf('-');
    if (dashIdx === -1) {
      const name = id.length >= 3 ? id.toUpperCase() : 'EMILY';
      return {
        message: t('home.errors.missingDash'),
        example: `${name}-07`,
      };
    }
    const prefix = id.slice(0, dashIdx);
    const suffix = id.slice(dashIdx + 1);
    if (prefix.length < 3) {
      return {
        message: t('home.errors.nameTooShort', {
          prefix: prefix.toUpperCase(),
        }),
        example: null,
      };
    }
    if (suffix.length === 0) {
      return {
        message: t('home.errors.noNumber'),
        example: `${prefix.toUpperCase()}-07`,
      };
    }
    if (/^\d$/.test(suffix)) {
      return {
        message: t('home.errors.singleDigit'),
        example: `${prefix.toUpperCase()}-0${suffix}`,
      };
    }
    return {
      message: t('home.errors.numberRequired'),
      example: `${prefix.toUpperCase()}-07`,
    };
  }

  return (
    <section className="parchment-glow flex flex-col items-center justify-center px-6 pb-10 pt-8 text-center">
      {/* Eyebrow */}
      <p className="mb-5 text-sm font-medium uppercase tracking-widest text-smoke">
        {t('home.eyebrow')}
      </p>

      {/* Headline */}
      <h1 className="font-heading mb-6 max-w-2xl text-5xl font-bold leading-tight tracking-tight text-char sm:text-6xl lg:text-7xl">
        {t('home.headline')}
      </h1>

      {/* Sub-headline */}
      <p className="mb-6 max-w-md text-lg text-smoke">
        {t('home.subheadline')}
      </p>

      <BetaBanner wrapperClassName="pt-1 pb-4" />

      {/* Search */}
      <form
        className="flex w-full max-w-[480px] flex-col items-center gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const id = inputRef.current?.value.trim();
          if (!id) return;
          if (!IDENTIFIER_RE.test(id)) {
            setInputError(formatError(id));
            setErrorKey((k) => k + 1);
            return;
          }
          setNotFoundId(null);
          setChecking(true);
          try {
            const r = await apiFetch(`/api/units/${id}/`);
            if (r.status === 404) {
              setNotFoundId(id);
              setErrorKey((k) => k + 1);
              return;
            }
          } catch {
            // Network error — navigate and let the unit page handle it
          } finally {
            setChecking(false);
          }
          navigate(`/unit/${id}/`);
        }}
      >
        <LighterInput
          inputRef={inputRef}
          onInput={() => {
            setInputError(null);
            setNotFoundId(null);
          }}
        />
        <button
          type="submit"
          disabled={checking}
          className="rounded-btn bg-amber px-10 py-3 text-base font-semibold tracking-wide text-white shadow-sm transition-transform hover:-translate-y-px active:translate-y-0 disabled:opacity-60"
        >
          {checking
            ? `${t('home.submit.checking')}…`
            : t('home.submit.default')}
        </button>
        {inputError && (
          <div
            key={errorKey}
            className="no-glow error-pop-anim w-full rounded-card bg-char px-5 py-4 text-center shadow-lg"
          >
            <p className="text-sm text-white/70">
              {inputError.message}
              {inputError.example && (
                <>
                  {' '}
                  {t('home.errors.like')}{' '}
                  <LighterName id={inputError.example} />.
                </>
              )}
            </p>
          </div>
        )}
        {notFoundId && (
          <div
            key={errorKey}
            className="no-glow error-pop-anim w-full rounded-card bg-char px-5 py-4 text-center shadow-lg"
          >
            <p className="font-medium text-white">{t('home.errors.offMap')}</p>
            <p className="mt-1 text-sm text-white/60">
              <Trans
                i18nKey="home.errors.notFound"
                values={{ id: notFoundId.toUpperCase(), example: 'EMILY-07' }}
                components={{
                  lighterName: (
                    <span className="font-handwriting uppercase text-base text-amber" />
                  ),
                }}
              />
            </p>
          </div>
        )}
      </form>

      {/* Scribble annotation – below the form, arrow points up at it */}
      <div className="mt-6 flex justify-center">
        <div
          className="relative -translate-x-10"
          style={{ paddingTop: '44px' }}
        >
          <img
            src={scribbleUpSrc}
            alt=""
            aria-hidden="true"
            className="absolute top-0 left-3 w-7"
          />
          <Link
            to="/unit/john-93"
            className="font-handwriting inline-block text-base text-char/50 transition-colors hover:text-char/70"
            style={{
              transform: 'rotate(-3deg)',
              transformOrigin: 'left center',
            }}
          >
            {t('home.tryExample')}
          </Link>
        </div>
      </div>
    </section>
  );
}
