import 'maplibre-gl/dist/maplibre-gl.css';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Trans, useTranslation } from 'react-i18next';
import ReactMap, {
  AttributionControl,
  Layer,
  Source,
} from 'react-map-gl/maplibre';
import type { MapRef } from 'react-map-gl/maplibre';
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { apiFetch } from '../api';
import GameIntroModal from '../components/GameIntroModal';
import TeamBadge from '../components/TeamBadge';
import { getEditToken } from '../lib/editTokens';
import { getGameConfig } from '../lib/gameConfig';
import { haversineKm } from '../lib/haversine';
import { formatKm, formatNumber } from '../lib/numbers';
import i18n from '../i18n';
import { useConfig } from '../lib/useConfig';

interface CheckInImage {
  id: number;
  image: string;
  order: number;
}

interface GeoPoint {
  type: 'Point';
  coordinates: [number, number]; // [lng, lat]
}

interface CheckInData {
  id: number;
  date_created: string;
  created_by_username: string | null;
  created_by_name: string | null;
  anonymous_name: string;
  images: CheckInImage[];
  message: string;
  place: string;
  location: GeoPoint;
  within_edit_grace_period: boolean;
}

interface GameData {
  id: number;
  name: string;
  mode: string;
  allowed_time: number;
  max_gps_drift: number;
  shelf_life: number;
  start_time: string;
  end_time: string;
}

interface TeamRef {
  name: string;
  color: string;
}

interface UnitData {
  identifier: string;
  checkin_count: number;
  subscriber_count: number;
  distance_traveled_km: number;
  is_subscribed: boolean;
  can_check_in: boolean | null;
  is_gps_enforced: boolean;
  team: TeamRef | null;
  game: GameData | null;
}

function parseLatLng(loc: GeoPoint): [number, number] {
  return [loc.coordinates[1], loc.coordinates[0]]; // GeoJSON is [lng, lat]; return [lat, lng]
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

// Returns [[minLng, minLat], [maxLng, maxLat]] for MapLibre fitBounds
function getBounds(
  points: [number, number][],
): [[number, number], [number, number]] {
  const lngs = points.map(([, lng]) => lng);
  const lats = points.map(([lat]) => lat);
  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ];
}

interface UnitMapProps {
  checkins: CheckInData[];
  resetKey: number;
  onMarkerClick: (checkin: CheckInData) => void;
  panToRef: React.MutableRefObject<
    ((pos: [number, number], zoom: number) => void) | null
  >;
  maptilerKey: string;
}

function UnitMap({
  checkins,
  resetKey,
  onMarkerClick,
  panToRef,
  maptilerKey,
}: UnitMapProps) {
  const mapRef = useRef<MapRef>(null);
  const ordered = useMemo(() => [...checkins].reverse(), [checkins]);
  const points = useMemo(
    () => ordered.map((c) => parseLatLng(c.location)),
    [ordered],
  );
  const [visibleCount, setVisibleCount] = useState(0);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [cursor, setCursor] = useState('grab');
  const prevResetKey = useRef(resetKey);
  const initialFitDone = useRef(false);

  useEffect(() => {
    if (points.length === 0) return;
    setVisibleCount(0);
    let count = 0;
    const delay = Math.max(80, Math.min(250, 1500 / points.length));
    const interval = setInterval(() => {
      count++;
      setVisibleCount(count);
      if (count >= points.length) clearInterval(interval);
    }, delay);
    return () => clearInterval(interval);
  }, [points.length]);

  const fitAllPoints = useCallback(() => {
    if (!mapRef.current || points.length === 0) return;
    if (points.length === 1) {
      mapRef.current.jumpTo({ center: [points[0][1], points[0][0]], zoom: 10 });
    } else {
      mapRef.current.fitBounds(getBounds(points), {
        padding: 30,
        animate: false,
      });
    }
  }, [points]);

  // Initial fit: runs once after map has loaded and points are available
  useEffect(() => {
    if (!mapLoaded || initialFitDone.current || points.length === 0) return;
    initialFitDone.current = true;
    fitAllPoints();
  }, [mapLoaded, points, fitAllPoints]);

  // Reset view when resetKey changes
  useEffect(() => {
    if (resetKey === prevResetKey.current) return;
    prevResetKey.current = resetKey;
    if (!mapRef.current || points.length === 0) return;
    if (points.length === 1) {
      mapRef.current.flyTo({
        center: [points[0][1], points[0][0]],
        zoom: 10,
        duration: 1000,
      });
    } else {
      mapRef.current.fitBounds(getBounds(points), { padding: 30 });
    }
  }, [resetKey, points]);

  // Expose pan function to parent's scroll handler
  useEffect(() => {
    panToRef.current = (pos, zoom) => {
      mapRef.current?.flyTo({ center: [pos[1], pos[0]], zoom, duration: 1200 });
    };
    return () => {
      panToRef.current = null;
    };
  }, [panToRef]);

  const animatedPoints = points.slice(0, visibleCount);

  const lineGeoJSON = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features:
        animatedPoints.length > 1
          ? [
              {
                type: 'Feature' as const,
                geometry: {
                  type: 'LineString' as const,
                  coordinates: animatedPoints.map(([lat, lng]) => [lng, lat]),
                },
                properties: {},
              },
            ]
          : [],
    }),
    [animatedPoints],
  );

  const markersGeoJSON = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: ordered.slice(0, visibleCount).map((checkin, i) => {
        const isFirst = i === 0;
        const isLast = i === ordered.length - 1;
        const color = isFirst ? '#e8a030' : isLast ? '#c94c35' : '#7b8fa1';
        return {
          type: 'Feature' as const,
          geometry: checkin.location,
          properties: {
            id: checkin.id,
            color,
            place: checkin.place,
            date: checkin.date_created,
            image: checkin.images[0]?.image ?? null,
          },
        };
      }),
    }),
    [ordered, visibleCount],
  );

  return (
    <ReactMap
      ref={mapRef}
      mapStyle={`https://api.maptiler.com/maps/dataviz/style.json?key=${maptilerKey}`}
      initialViewState={{ longitude: 0, latitude: 20, zoom: 2 }}
      onLoad={() => setMapLoaded(true)}
      style={{ width: '100%', height: '100%' }}
      attributionControl={false}
      cursor={cursor}
      interactiveLayerIds={['markers-circle']}
      onMouseMove={(e) =>
        setCursor(e.features && e.features.length > 0 ? 'pointer' : 'grab')
      }
      onClick={(e) => {
        const feature = e.features?.[0];
        if (feature?.layer?.id === 'markers-circle') {
          const checkin = ordered.find((c) => c.id === feature.properties?.id);
          if (checkin) onMarkerClick(checkin);
        }
      }}
    >
      <Source id="route" type="geojson" data={lineGeoJSON}>
        <Layer
          id="route-line"
          type="line"
          paint={{
            'line-color': '#7b8fa1',
            'line-width': 2,
            'line-opacity': 0.7,
          }}
        />
      </Source>
      <Source id="markers" type="geojson" data={markersGeoJSON}>
        <Layer
          id="markers-circle"
          type="circle"
          paint={{
            'circle-radius': 8,
            'circle-color': ['get', 'color'],
            'circle-opacity': 0.85,
            'circle-stroke-width': 1.5,
            'circle-stroke-color': '#ffffff',
          }}
        />
      </Source>
      <AttributionControl compact position="bottom-right" />
    </ReactMap>
  );
}

interface ImageCarouselProps {
  images: CheckInImage[];
  onImageClick: (url: string) => void;
}

function ImageCarousel({ images, onImageClick }: ImageCarouselProps) {
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

export default function Unit() {
  const { t } = useTranslation();
  const { identifier = '' } = useParams<{ identifier: string }>();
  const { isAuthenticated, username: currentUsername } = useAuth();
  const config = useConfig();
  const maptilerKey = config?.maptilerKey ?? '';
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
  const [unit, setUnit] = useState<UnitData | null>(null);
  const [checkins, setCheckins] = useState<CheckInData[]>([]);
  const [gameRank, setGameRank] = useState<number | null>(null);
  const [gameTotal, setGameTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [subscribeLoading, setSubscribeLoading] = useState(false);
  const [mapResetKey, setMapResetKey] = useState(0);
  const [mapIsReset, setMapIsReset] = useState(true);
  const [visibleIds, setVisibleIds] = useState<Set<number>>(new Set());
  const [focusedCheckinId, setFocusedCheckinId] = useState<number | null>(null);
  const [modalImageUrl, setModalImageUrl] = useState<string | null>(null);
  const [showGameModal, setShowGameModal] = useState(false);
  const timelineRefs = useRef<Map<number, HTMLLIElement>>(new Map());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const wasScrolledRef = useRef(false);
  const mapPanToRef = useRef<
    ((pos: [number, number], zoom: number) => void) | null
  >(null);
  const panTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const checkinsRef = useRef(checkins);
  const mapWrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([
      fetch(`/api/units/${identifier}/`).then((r) => {
        if (r.status === 404) {
          setNotFound(true);
          return null;
        }
        return r.json() as Promise<UnitData>;
      }),
      fetch(`/api/units/${identifier}/checkins/`).then((r) => r.json()),
    ])
      .then(([unitData, checkinData]) => {
        if (!unitData) return;
        setUnit(unitData as UnitData);
        setCheckins(
          Array.isArray(checkinData)
            ? (checkinData as CheckInData[])
            : (checkinData as { results: CheckInData[] }).results,
        );
        if (
          unitData.game &&
          !sessionStorage.getItem(`game-intro-seen-${unitData.game.id}`)
        ) {
          setShowGameModal(true);
        }
        // Rank/total are not on the unit endpoint — they live on the leaderboard,
        // which is itself cached for 5 min. Fetch async so the page renders
        // immediately and rank pops in once the second response arrives.
        // Pass ?from=<identifier> so this unit's row returns its identifier
        // (other rows are nulled out to prevent slug enumeration).
        if (unitData.game) {
          const url = `/api/games/${unitData.game.id}/leaderboard/?from=${encodeURIComponent(unitData.identifier)}`;
          fetch(url)
            .then((r) => (r.ok ? r.json() : null))
            .then(
              (
                board: {
                  individual: { identifier: string | null; rank: number }[];
                } | null,
              ) => {
                if (!board) return;
                const entry = board.individual.find(
                  (e) => e.identifier === unitData.identifier,
                );
                if (!entry) return;
                setGameRank(entry.rank);
                setGameTotal(board.individual.length);
              },
            )
            .catch(console.error);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [identifier]);

  useEffect(() => {
    checkinsRef.current = checkins;
  }, [checkins]);

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

  async function handleSubscribe() {
    if (!isAuthenticated) {
      navigate(
        `/accounts/login/?next=${encodeURIComponent(`/unit/${identifier}/`)}`,
      );
      return;
    }
    setSubscribeLoading(true);
    try {
      const method = unit?.is_subscribed ? 'DELETE' : 'POST';
      await apiFetch(`/api/units/${identifier}/subscribe/`, { method });
      setUnit((u) => (u ? { ...u, is_subscribed: !u.is_subscribed } : u));
    } catch (e) {
      console.error(e);
    } finally {
      setSubscribeLoading(false);
    }
  }

  async function handleDelete(checkinId: number) {
    if (!confirm(t('unit.deleteConfirm'))) return;
    const headers: Record<string, string> = {};
    if (!isAuthenticated) {
      const token = getEditToken(checkinId);
      if (token) headers['X-Edit-Token'] = token;
    }
    const r = await apiFetch(
      `/api/units/${identifier}/checkins/${checkinId}/`,
      { method: 'DELETE', headers },
    );
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      alert(body?.detail ?? t('unit.deleteError'));
      return;
    }
    setCheckins((cs) => cs.filter((c) => c.id !== checkinId));
  }

  function handleMarkerClick(checkin: CheckInData) {
    const el = timelineRefs.current.get(checkin.id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-16 text-center text-smoke">
        {t('common.loading')}…
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 py-16 text-center">
        <p className="font-heading mb-4 text-[6rem] font-bold leading-none text-char/10">
          ?
        </p>
        <h1 className="font-heading mb-2 text-2xl font-semibold text-char">
          {t('unit.notFound.heading')}
        </h1>
        <p className="mb-1 max-w-sm text-smoke">
          <Trans
            i18nKey="unit.notFound.body1"
            values={{ identifier }}
            components={{ strong: <strong className="text-char" /> }}
          />
        </p>
        <p className="mb-8 max-w-sm text-smoke">
          <Trans
            i18nKey="unit.notFound.body2"
            components={{
              handwriting: (
                <strong className="font-handwriting text-lg text-char" />
              ),
            }}
          />
        </p>
        <Link
          to="/"
          className="rounded-btn bg-amber px-[22px] py-[9px] text-sm font-semibold tracking-wide text-char transition-transform hover:-translate-y-px active:translate-y-0"
        >
          {t('unit.notFound.cta')}
        </Link>
      </div>
    );
  }

  if (!unit) return null;

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
                  {identifier}
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
                    {formatNumber(unit.subscriber_count)}
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
                  <Link
                    to={checkinUrl}
                    className="rounded-btn bg-amber px-[18px] py-[7px] text-sm font-medium tracking-wide text-char transition-transform hover:-translate-y-px active:translate-y-0"
                  >
                    {t('unit.checkinBtn')}
                  </Link>
                )}
                {isAuthenticated && unit.can_check_in === false && (
                  <p className="text-sm italic text-white/40">
                    {t('unit.passedOn')}
                  </p>
                )}
                <button
                  onClick={handleSubscribe}
                  disabled={subscribeLoading}
                  className={`rounded-btn px-[18px] py-[7px] text-sm font-medium tracking-wide transition-transform hover:-translate-y-px active:translate-y-0 disabled:pointer-events-none disabled:opacity-50 ${
                    unit.is_subscribed
                      ? 'bg-ember text-white'
                      : 'border border-white/20 bg-white/15 text-white'
                  }`}
                >
                  {unit.is_subscribed
                    ? t('unit.unsubscribe')
                    : t('unit.subscribe')}
                </button>

                {unit.game && (
                  <div className="ml-auto flex flex-wrap items-center gap-3">
                    {getGameConfig(unit.game.mode)?.hasLeaderboard && (
                      <Link
                        to={`/game/${unit.game.id}/leaderboard/?from=${encodeURIComponent(unit.identifier)}`}
                        className="rounded-btn bg-amber px-[18px] py-[7px] text-sm font-medium tracking-wide text-char transition-transform hover:-translate-y-px active:translate-y-0"
                      >
                        {t('unit.game.leaderboardLink')}
                      </Link>
                    )}
                    <button
                      type="button"
                      onClick={() => setShowGameModal(true)}
                      className="rounded-btn border border-white/20 bg-white/15 px-[18px] py-[7px] text-sm font-medium tracking-wide text-white transition-transform hover:-translate-y-px active:translate-y-0"
                    >
                      {t('unit.game.showRules')}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Right: latest check-in photo */}
            {heroImageUrl && (
              <div className="relative hidden sm:block sm:w-56 md:w-72 shrink-0">
                <img
                  src={heroImageUrl}
                  alt=""
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
            <div className="relative h-[280px] sm:h-[450px]">
              <UnitMap
                checkins={checkins}
                resetKey={mapResetKey}
                onMarkerClick={handleMarkerClick}
                panToRef={mapPanToRef}
                maptilerKey={maptilerKey}
              />
              {!mapIsReset && (
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
              const isOwn =
                (isAuthenticated &&
                  c.created_by_username === currentUsername) ||
                (!isAuthenticated &&
                  !c.created_by_username &&
                  !!getEditToken(c.id));
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
                    <div className="flex gap-2 border-t border-char/5 bg-linen/30 px-4 py-3">
                      {c.within_edit_grace_period ? (
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
                      ) : (
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
