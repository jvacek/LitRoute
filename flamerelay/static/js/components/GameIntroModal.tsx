import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import type { components } from '../api/schema';
import { humanizeHours } from '../lib/duration';
import { getGameConfig } from '../lib/gameConfig';
import { setLeaderboardFrom } from '../lib/leaderboardFrom';
import { outlineBtnMd, primaryBtnMd } from '../styles';

interface Props {
  game: components['schemas']['Game'];
  fromIdentifier?: string;
  onDismiss: () => void;
}

export default function GameIntroModal({
  game,
  fromIdentifier,
  onDismiss,
}: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const config = getGameConfig(game.mode);
  if (!config) return null;

  const body = t(config.rulesKey, {
    duration: humanizeHours(t, game.allowed_time ?? 0),
    maxDrift: game.gps_drift_floor,
    shelfLife: game.shelf_life,
  });

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-card bg-parchment p-6 shadow-xl">
        <div className="mb-3 flex items-center gap-3">
          <span aria-hidden="true" className="text-2xl">
            {config.icon}
          </span>
          <div>
            <h2 className="font-heading text-xl font-bold text-char">
              {game.name}
            </h2>
            <p className="mt-0.5 text-xs uppercase tracking-wide text-char/60">
              {t(config.name)}
            </p>
          </div>
        </div>
        <p className="mb-6 text-sm leading-relaxed text-char/80">{body}</p>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          {config.hasLeaderboard && (
            <button
              type="button"
              className={outlineBtnMd}
              onClick={() => {
                onDismiss();
                if (fromIdentifier) {
                  setLeaderboardFrom(game.id, fromIdentifier);
                }
                navigate(`/game/${game.id}/leaderboard/`);
              }}
            >
              {t('game.modal.viewLeaderboard')} →
            </button>
          )}
          <button type="button" className={primaryBtnMd} onClick={onDismiss}>
            {t('game.modal.gotIt')}
          </button>
        </div>
      </div>
    </div>
  );
}
