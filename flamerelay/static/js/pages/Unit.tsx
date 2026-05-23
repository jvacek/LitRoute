import { useEffect, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import {
  Link,
  useLoaderData,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { apiFetch } from '../api';
import type { components } from '../api/schema';
import GameIntroModal from '../components/GameIntroModal';
import GuestEmailCapture from '../components/GuestEmailCapture';
import ImageCarousel from '../components/ImageCarousel';
import TeamBadge from '../components/TeamBadge';
import type UnitMapComponent from '../components/UnitMap';
import { amberCharBtnMd, fieldErrorClass, outlineOnDarkBtnMd } from '../styles';
import { getEditToken } from '../lib/editTokens';
import { getGameConfig } from '../lib/gameConfig';
import { haversineKm } from '../lib/haversine';
import { formatKm, formatNumber } from '../lib/numbers';
import i18n from '../i18n';
import { reportError } from '../lib/sentry';
import { useConfig } from '../lib/useConfig';
import type { UnitLoaderData } from './Unit.loader';

type CheckInData = components['schemas']['CheckIn'];
type UnitData = components['schemas']['Unit'];

function parseLatLng(loc: CheckInData['location']): [number, number] {
  // GeoJSON is [lng, lat]; return [lat, lng]. Spectacular widens the
  // tuple to `number[]`, so narrow at the boundary.
  const [lng, lat] = loc.coordinates as [number, number];
  return [lat, lng];
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(i18n.resolvedLanguage, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function comfortZoom(
  pos: [number, number],
  checkins: CheckInData[],
  id: number,
): number {
  const idx = checkins.findIndex((c) => c.id === id);
  const neighbors: [number, number][] = [];
  if (idx > 0) neighbors.push(parseLatLng(checkins[idx - 1].location));
  if (idx < checkins.length - 1)
    neighbors.push(parseLatLng(checkins[idx + 1].location));
  if (neighbors.length === 0) return 9;
  const maxDist = Math.max(...neighbors.map((n) => haversineKm(pos, n)));
  if (maxDist > 3000) return 4;
  if (maxDist > 1000) return 5;
  if (maxDist > 400) return 6;
  if (maxDist > 150) return 7;
  if (maxDist > 60) return 8;
  if (maxDist > 20) return 9;
  return 10;
}

export default function Unit() {
  const { t } = useTranslation();
  const { identifier = '' } = useParams<{ identifier: string }>();
  const { isAuthenticated, username: currentUsername } = useAuth();
  const { maptilerKey } = useConfig();
  const [searchParams] = useSearchParams();
  const showVerifiedBanner = searchParams.get('verified') === '1';

  function heroStatus(checkin: CheckInData): string {
    const days = Math.floor(
      (Date.now() - new Date(checkin.date_created).getTime()) / 86400000,
    );
    const place = checkin.place || t('unit.placeNotGiven');
    if (days === 0) return t('unit.status.currentlyIn', { place });
    if (days === 1) return t('unit.status.lastSeenYesterday', { place });
    return t('unit.status.lastSeenDaysAgo', { count: days, place });
  }
  const checkinUrl = `/unit/${identifier}/checkin`;
  const navigate = useNavigate();
  const loaderData = useLoaderData() as UnitLoaderData;
  // Local copies so mutations (follow toggle, delete) can update the UI
  // without a full route revalidation. Seeded from loader data; the route
  // wrapper re-mounts on pathname changes, so these reset naturally on
  // navigation between units.
  const [unit, setUnit] = useState<UnitData>(loaderData.unit);
  const [checkins, setCheckins] = useState<CheckInData[]>(loaderData.checkins);
  const [gameRank, setGameRank] = useState<number | null>(null);
  const [gameTotal, setGameTotal] = useState<number | null>(null);
  const [followLoading, setFollowLoading] = useState(false);
  const [followError, setFollowError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // sessionStorage is read at mount only — unit.game is fixed from the loader
  // (route remounts on navigation), so a useState initializer fits better than
  // a useEffect with a setState call.
  const [showGameModal, setShowGameModal] = useState(
    () =>
      !!loaderData.unit.game &&
      !sessionStorage.getItem(`game-intro-seen-${loaderData.unit.game.id}`),
  );
  const [mapResetKey, setMapResetKey] = useState(0);
  const [mapIsReset, setMapIsReset] = useState(true);
  // <UnitMap> pulls in maplibre-gl + react-map-gl — a ~1 MiB chunk that
  // shouldn't block the QR-landing first paint. Load the module at idle (or
  // 2s timeout fallback) so the page paints first and the map fills in.
  const [MapModule, setMapModule] = useState<ComponentType<
    React.ComponentProps<typeof UnitMapComponent>
  > | null>(null);
  const [visibleIds, setVisibleIds] = useState<Set<number>>(new Set());
  const [focusedCheckinId, setFocusedCheckinId] = useState<number | null>(null);
  const [modalImageUrl, setModalImageUrl] = useState<string | null>(null);
  const [claimingCheckinId, setClaimingCheckinId] = useState<number | null>(
    null,
  );
  const timelineRefs = useRef<Map<number, HTMLLIElement>>(new Map());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const wasScrolledRef = useRef(false);
  const mapPanToRef = useRef<
    ((pos: [number, number], zoom: number) => void) | null
  >(null);
  const panTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const checkinsRef = useRef(checkins);
  const mapWrapperRef = useRef<HTMLDivElement>(null);

  // Rank/total are not on the unit endpoint — they live on the leaderboard,
  // which is itself cached for 5 min. Fetched here (not in the loader) so the
  // page renders immediately and rank pops in once the response arrives.
  // Pass ?from=<identifier> so this unit's row returns its identifier
  // (other rows are nulled out to prevent slug enumeration).
  useEffect(() => {
    if (!unit.game) return;
    let cancelled = false;
    const url = `/api/games/${unit.game.id}/leaderboard/?from=${encodeURIComponent(unit.identifier)}`;
    apiFetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (
          board: {
            individual: { identifier: string | null; rank: number }[];
          } | null,
        ) => {
          if (cancelled || !board) return;
          const entry = board.individual.find(
            (e) => e.identifier === unit.identifier,
          );
          if (!entry) return;
          setGameRank(entry.rank);
          setGameTotal(board.individual.length);
        },
      );
    return () => {
      cancelled = true;
    };
  }, [unit.game, unit.identifier]);

  useEffect(() => {
    checkinsRef.current = checkins;
  }, [checkins]);

  // Defer the maplibre chunk load until the browser is idle (or 2s timeout).
  // Until then the placeholder div reserves the layout so paint isn't blocked.
  useEffect(() => {
    if (checkins.length === 0) return;
    let cancelled = false;
    const load = () => {
      import(
        /* webpackChunkName: "components-UnitMap" */ '../components/UnitMap'
      ).then((m) => {
        if (!cancelled) setMapModule(() => m.default);
      });
    };
    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(load, { timeout: 2000 });
      return () => {
        cancelled = true;
        window.cancelIdleCallback(id);
      };
    }
    const id = setTimeout(load, 200);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [checkins.length]);

  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const idStr = entry.target.getAttribute('data-id');
            if (idStr) {
              const id = parseInt(idStr, 10);
              setVisibleIds((prev) => {
                const next = new Set(prev);
                next.add(id);
                return next;
              });
              observerRef.current?.unobserve(entry.target);
            }
          }
        });
      },
      { threshold: 0.05, rootMargin: '0px 0px -40px 0px' },
    );
    return () => observerRef.current?.disconnect();
  }, []);

  useEffect(() => {
    function onScroll() {
      if (window.scrollY > 100) {
        wasScrolledRef.current = true;
      } else if (wasScrolledRef.current && window.scrollY < 50) {
        wasScrolledRef.current = false;
        if (panTimeoutRef.current) clearTimeout(panTimeoutRef.current);
        setMapResetKey((k) => k + 1);
        setMapIsReset(true);
        setFocusedCheckinId(null);
        return;
      }

      // Debounced flyTo: find the timeline card closest to viewport centre
      if (window.scrollY < 100) return;
      if (panTimeoutRef.current) clearTimeout(panTimeoutRef.current);
      panTimeoutRef.current = setTimeout(() => {
        if (!mapPanToRef.current) return;
        // Use the centre of the visible area below the sticky map, not the full viewport centre
        const mapBottom =
          mapWrapperRef.current?.getBoundingClientRect().bottom ?? 0;
        const centre = mapBottom + (window.innerHeight - mapBottom) / 2;
        const atBottom =
          window.scrollY + window.innerHeight >=
          document.documentElement.scrollHeight - 80;
        let closestId: number | null = null;
        let closestPos: [number, number] | null = null;
        let closestDist = Infinity;
        for (const [id, el] of timelineRefs.current) {
          const rect = el.getBoundingClientRect();
          const dist = Math.abs((rect.top + rect.bottom) / 2 - centre);
          if (dist < closestDist) {
            closestDist = dist;
            closestId = id;
            const c = checkinsRef.current.find((x) => x.id === id);
            if (c) closestPos = parseLatLng(c.location);
          }
        }
        // At the very bottom always select the last (oldest) card
        if (atBottom && checkinsRef.current.length > 0) {
          const last = checkinsRef.current[checkinsRef.current.length - 1];
          closestId = last.id;
          closestPos = parseLatLng(last.location);
        }
        if (closestPos && closestId !== null) {
          const zoom = comfortZoom(closestPos, checkinsRef.current, closestId);
          mapPanToRef.current(closestPos, zoom);
          setMapIsReset(false);
        }
        setFocusedCheckinId(closestId);
      }, 80);
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (panTimeoutRef.current) clearTimeout(panTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setModalImageUrl(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function handleFollow() {
    if (!isAuthenticated) {
      navigate(
        `/accounts/login/?next=${encodeURIComponent(`/unit/${identifier}/`)}`,
      );
      return;
    }
    setFollowLoading(true);
    setFollowError(null);
    try {
      const method = unit?.is_following ? 'DELETE' : 'POST';
      const r = await apiFetch(`/api/units/${identifier}/follow/`, {
        method,
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        setFollowError(body?.detail ?? t('unit.followError'));
        return;
      }
      setUnit((u) => (u ? { ...u, is_following: !u.is_following } : u));
    } catch (e) {
      // Quiet on network throws — the button visibly stayed in its prior
      // state, the user can retry. reportError filters network noise from
      // Sentry; real bugs still surface there.
      reportError(e, { where: 'Unit.follow' });
    } finally {
      setFollowLoading(false);
    }
  }

  async function handleDelete(checkinId: number) {
    if (!confirm(t('unit.deleteConfirm'))) return;
    const headers: Record<string, string> = {};
    if (!isAuthenticated) {
      const token = getEditToken(checkinId);
      if (token) headers['X-Edit-Token'] = token;
    }
    setDeleteError(null);
    try {
      const r = await apiFetch(
        `/api/units/${identifier}/checkins/${checkinId}/`,
        { method: 'DELETE', headers },
      );
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        setDeleteError(body?.detail ?? t('unit.deleteError'));
        return;
      }
      setCheckins((cs) => cs.filter((c) => c.id !== checkinId));
    } catch (e) {
      // Quiet on network throws — the row didn't disappear, user can retry.
      reportError(e, { where: 'Unit.delete' });
    }
  }

  function handleMarkerClick(checkin: CheckInData) {
    const el = timelineRefs.current.get(checkin.id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  const currentCheckin = checkins[0] ?? null;
  const heroImageUrl = currentCheckin?.images[0]?.image ?? null;
  const stopsCount = unit.checkin_count;

  return (
    <>
      <main className="mx-auto max-w-5xl px-6 py-10">
        {showVerifiedBanner && (
          <div className="mb-6 rounded-card border border-amber/30 bg-amber/10 px-5 py-3 text-sm font-medium text-char">
            {t('unit.verifiedBanner')}
          </div>
        )}
        {/* Hero */}
        <div className="mb-8 overflow-hidden rounded-card bg-char">
          <div className="flex flex-col sm:flex-row">
            {/* Left: text + stats + CTAs */}
            <div className="flex flex-1 flex-col justify-between p-6 sm:p-8">
              <div>
                <h1 className="font-heading mb-1 text-3xl font-bold text-white sm:text-4xl">
                  {identifier.toUpperCase()}
                </h1>
                {currentCheckin ? (
                  <p className="text-sm font-medium text-amber">
                    {heroStatus(currentCheckin)}
                  </p>
                ) : (
                  <p className="text-sm italic text-white/40">
                    {t('unit.noCheckinsYet')}
                  </p>
                )}
              </div>

              {/* Stats */}
              <div className="my-6 flex flex-wrap gap-6 border-t border-white/10 pt-5">
                {unit.distance_traveled_km > 0 && (
                  <div>
                    <div className="font-heading text-2xl font-bold text-white">
                      {formatKm(unit.distance_traveled_km)}
                    </div>
                    <div className="mt-0.5 text-xs uppercase tracking-wide text-white/40">
                      {t('unit.statsKmTraveled')}
                    </div>
                  </div>
                )}
                <div>
                  <div className="font-heading text-2xl font-bold text-white">
                    {formatNumber(stopsCount)}
                  </div>
                  <div className="mt-0.5 text-xs uppercase tracking-wide text-white/40">
                    {t('unit.statsStops')}
                  </div>
                </div>
                <div>
                  <div className="font-heading text-2xl font-bold text-white">
                    {formatNumber(unit.follower_count)}
                  </div>
                  <div className="mt-0.5 text-xs uppercase tracking-wide text-white/40">
                    {t('unit.statsFollowers')}
                  </div>
                </div>
                {unit.game && gameRank != null && (
                  <div>
                    <div className="font-heading text-2xl font-bold text-white">
                      #{gameRank}
                    </div>
                    <div className="mt-0.5 text-xs uppercase tracking-wide text-white/40">
                      {t('unit.game.rankLabel', {
                        total: formatNumber(gameTotal ?? 0),
                      })}
                    </div>
                  </div>
                )}
                {unit.team && (
                  <div>
                    <div className="flex h-8 items-center">
                      <TeamBadge
                        name={unit.team.name}
                        color={unit.team.color}
                      />
                    </div>
                    <div className="mt-0.5 text-xs uppercase tracking-wide text-white/40">
                      {t('unit.statsTeam')}
                    </div>
                  </div>
                )}
              </div>

              {/* CTAs */}
              <div className="flex flex-wrap items-center gap-3">
                {unit.can_check_in !== false && (
                  <Link to={checkinUrl} className={amberCharBtnMd}>
                    {t('unit.checkinBtn')}
                  </Link>
                )}
                {isAuthenticated && unit.can_check_in === false && (
                  <p className="text-sm italic text-white/40">
                    {t('unit.passedOn')}
                  </p>
                )}
                <button
                  onClick={handleFollow}
                  disabled={followLoading}
                  className={`rounded-btn px-[18px] py-[7px] text-sm font-medium tracking-wide transition-transform hover:-translate-y-px active:translate-y-0 disabled:pointer-events-none disabled:opacity-50 ${
                    unit.is_following
                      ? 'bg-ember text-white'
                      : 'border border-white/20 bg-white/15 text-white'
                  }`}
                >
                  {unit.is_following ? t('unit.unfollow') : t('unit.follow')}
                </button>
                {followError && (
                  <p role="alert" className="basis-full text-sm text-ember">
                    {followError}
                  </p>
                )}

                {unit.game && (
                  <div className="ml-auto flex flex-wrap items-center gap-3">
                    {getGameConfig(unit.game.mode)?.hasLeaderboard && (
                      <Link
                        to={`/game/${unit.game.id}/leaderboard/?from=${encodeURIComponent(unit.identifier)}`}
                        className={amberCharBtnMd}
                      >
                        {t('unit.game.leaderboardLink')}
                      </Link>
                    )}
                    <button
                      type="button"
                      onClick={() => setShowGameModal(true)}
                      className={outlineOnDarkBtnMd}
                    >
                      {t('unit.game.showRules')}
                    </button>
                  </div>
                )}
              </div>

              {unit.game && getGameConfig(unit.game.mode)?.hasLeaderboard && (
                <Link
                  to={`/game/${unit.game.id}/leaderboard/?from=${encodeURIComponent(unit.identifier)}`}
                  className="mt-4 inline-block text-sm font-medium text-amber hover:text-white"
                >
                  {t('unit.game.leaderboardLink')}
                </Link>
              )}
            </div>

            {/* Right: latest check-in photo */}
            {heroImageUrl && (
              <div className="relative hidden sm:block sm:w-56 md:w-72 shrink-0">
                <img
                  src={heroImageUrl}
                  alt=""
                  fetchPriority="high"
                  decoding="async"
                  className="absolute inset-0 h-full w-full object-cover"
                />
              </div>
            )}
          </div>
        </div>

        {/* Map — sticks below the navbar while scrolling the timeline */}
        {checkins.length > 0 && (
          <div
            ref={mapWrapperRef}
            className="sticky top-0 z-[60] mb-8 -mx-6 overflow-hidden sm:top-16 sm:z-10 sm:rounded-card sm:border sm:border-char/10"
          >
            <div className="relative h-[280px] sm:h-[450px] bg-linen">
              {MapModule ? (
                <MapModule
                  checkins={checkins}
                  resetKey={mapResetKey}
                  onMarkerClick={handleMarkerClick}
                  panToRef={mapPanToRef}
                  maptilerKey={maptilerKey}
                />
              ) : (
                <div
                  className="absolute inset-0 flex items-center justify-center text-smoke/60"
                  aria-busy="true"
                >
                  <span className="text-xs uppercase tracking-wide">
                    {t('unit.mapLoading')}
                  </span>
                </div>
              )}
              {MapModule && !mapIsReset && (
                <button
                  onClick={() => {
                    setMapResetKey((k) => k + 1);
                    setMapIsReset(true);
                  }}
                  className="absolute bottom-8 left-1/2 z-[500] -translate-x-1/2 rounded-full bg-white/90 px-4 py-1.5 text-xs font-medium text-char shadow-md backdrop-blur-sm hover:bg-white"
                >
                  {t('unit.resetView')}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Timeline */}
        <h2 className="font-heading mb-6 text-2xl font-bold text-char">
          {t('unit.travelLog')}
        </h2>
        {deleteError && (
          <p role="alert" className={`${fieldErrorClass} mb-4`}>
            {deleteError}
          </p>
        )}
        {checkins.length === 0 ? (
          <div className="rounded-card border border-char/10 bg-white px-6 py-10 text-center shadow-sm">
            {/* Placeholder for hand-drawn illustration — swap this div for an <img> when the asset is ready */}
            <div className="mx-auto mb-6 flex h-32 w-32 items-center justify-center rounded-full border-2 border-dashed border-amber/30 text-4xl text-amber/30">
              ✦
            </div>
            <p className="font-heading mb-2 text-xl font-bold text-char/70">
              {t('unit.gettingStarted.heading')}
            </p>
            <p className="mb-6 text-sm text-smoke">
              {t('unit.gettingStarted.body')}
            </p>
            <Link
              to={checkinUrl}
              className="rounded-btn bg-amber px-6 py-3 text-base font-semibold tracking-wide text-char transition-transform hover:-translate-y-px active:translate-y-0"
            >
              {t('unit.gettingStarted.cta')}
            </Link>
          </div>
        ) : (
          <ul className="space-y-6">
            {checkins.map((c, idx) => {
              const isAnonOwned =
                !isAuthenticated &&
                !c.created_by_username &&
                !!getEditToken(c.id);
              const isOwn =
                (isAuthenticated &&
                  c.created_by_username === currentUsername) ||
                isAnonOwned;
              const editUrl = `/unit/${identifier}/checkin/${c.id}`;
              const isCurrent = idx === 0;
              const isOrigin = idx === checkins.length - 1;
              const isVisible = visibleIds.has(c.id);

              return (
                <li
                  key={c.id}
                  data-id={c.id}
                  ref={(el) => {
                    if (el) {
                      timelineRefs.current.set(c.id, el);
                      if (!visibleIds.has(c.id)) {
                        observerRef.current?.observe(el);
                      }
                    } else {
                      timelineRefs.current.delete(c.id);
                    }
                  }}
                  className={`overflow-hidden rounded-card border bg-white shadow-sm transition-[border-color,box-shadow] duration-300 ${
                    focusedCheckinId === c.id
                      ? 'border-amber shadow-md shadow-amber/20'
                      : 'border-char/10'
                  }`}
                  style={{
                    opacity: isVisible ? 1 : 0,
                    transform: isVisible ? 'translateY(0)' : 'translateY(16px)',
                    transition:
                      'opacity 0.5s ease-out, transform 0.5s ease-out, border-color 0.3s, box-shadow 0.3s',
                  }}
                >
                  {checkins.length > 1 && isOrigin && (
                    <div className="border-b border-amber/20 bg-amber/10 px-4 py-2">
                      <span className="text-xs font-medium uppercase tracking-wide text-amber/80">
                        {t('unit.origin')}
                      </span>
                    </div>
                  )}
                  {checkins.length > 1 && isCurrent && (
                    <div className="border-b border-ember/20 bg-ember/10 px-4 py-2">
                      <span className="text-xs font-medium uppercase tracking-wide text-ember">
                        {t('unit.currentLocation')}
                      </span>
                    </div>
                  )}

                  <div className="flex items-center justify-between bg-linen/60 px-4 py-3">
                    <span className="font-medium text-char">
                      {c.place ? (
                        c.place
                      ) : (
                        <em className="text-smoke">
                          {t('unit.placeNotGiven')}
                        </em>
                      )}
                    </span>
                    <span className="text-xs text-smoke">
                      {fmtDate(c.date_created)}
                    </span>
                  </div>

                  <div className="flex flex-col gap-3 p-4 sm:flex-row sm:gap-4">
                    <div className="flex min-w-0 flex-1 flex-col">
                      {c.message && (
                        <p className="mb-4 text-base text-char/80">
                          {c.message}
                        </p>
                      )}
                      <div className="mt-auto flex justify-end">
                        <span
                          className="font-handwriting text-2xl text-char/60"
                          style={{ transform: 'rotate(-2deg)' }}
                        >
                          {c.created_by_name || c.created_by_username}
                        </span>
                      </div>
                    </div>
                    {c.images.length > 0 && (
                      <div className="aspect-square shrink-0 overflow-hidden rounded-lg sm:w-48 md:w-56">
                        <ImageCarousel
                          images={c.images}
                          onImageClick={setModalImageUrl}
                        />
                      </div>
                    )}
                  </div>

                  {isOwn && (
                    <div className="flex flex-wrap items-center gap-2 border-t border-char/5 bg-linen/30 px-4 py-3">
                      {c.within_edit_grace_period && (
                        <>
                          <Link
                            to={editUrl}
                            className="rounded bg-smoke/15 px-3 py-1 text-xs font-medium text-char hover:bg-smoke/25"
                          >
                            {t('unit.editBtn')}
                          </Link>
                          <button
                            onClick={() => handleDelete(c.id)}
                            className="rounded bg-ember/10 px-3 py-1 text-xs font-medium text-ember hover:bg-ember/20"
                          >
                            {t('unit.deleteBtn')}
                          </button>
                        </>
                      )}
                      {isAnonOwned && (
                        <button
                          onClick={() => setClaimingCheckinId(c.id)}
                          className="rounded bg-amber/15 px-3 py-1 text-xs font-medium text-amber hover:bg-amber/25"
                        >
                          {t('unit.claimBtn')}
                        </button>
                      )}
                      {!c.within_edit_grace_period && !isAnonOwned && (
                        <span className="text-xs text-smoke/60">
                          {t('unit.cannotEdit')}
                        </span>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {checkins.length >= 3 && (
          <div className="mt-8 rounded-card border border-char/10 bg-linen p-5 text-center">
            <p className="text-sm text-char/60">
              <Trans
                i18nKey="unit.supportPrompt"
                components={{
                  supportLink: (
                    <Link
                      to="/support/"
                      className="text-amber underline-offset-2 hover:underline"
                    />
                  ),
                }}
              />
            </p>
          </div>
        )}
      </main>

      {claimingCheckinId !== null && (
        <div
          className="fixed inset-0 z-[2000] flex cursor-pointer items-center justify-center bg-black/60 px-4"
          onClick={() => setClaimingCheckinId(null)}
        >
          <div className="cursor-default" onClick={(e) => e.stopPropagation()}>
            <GuestEmailCapture
              identifier={unit.identifier}
              checkinId={claimingCheckinId}
              followerCount={unit.follower_count}
              onDone={() => setClaimingCheckinId(null)}
            />
          </div>
        </div>
      )}

      {/* Fullscreen image modal */}
      {modalImageUrl && (
        <div
          className="fixed inset-0 z-[2000] flex cursor-pointer items-center justify-center bg-black/90 p-4"
          onClick={() => setModalImageUrl(null)}
        >
          <img
            src={modalImageUrl}
            alt=""
            className="max-h-full max-w-full cursor-default rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-lg text-white hover:bg-white/30"
            onClick={() => setModalImageUrl(null)}
          >
            ✕
          </button>
        </div>
      )}

      {showGameModal && unit.game && (
        <GameIntroModal
          game={unit.game}
          fromIdentifier={unit.identifier}
          onDismiss={() => {
            sessionStorage.setItem(`game-intro-seen-${unit.game!.id}`, '1');
            setShowGameModal(false);
          }}
        />
      )}
    </>
  );
}
