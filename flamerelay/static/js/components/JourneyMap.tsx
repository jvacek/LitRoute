import 'maplibre-gl/dist/maplibre-gl.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMap, {
  AttributionControl,
  Layer,
  Source,
} from 'react-map-gl/maplibre';
import type { MapRef } from 'react-map-gl/maplibre';

interface JourneyPoint {
  lng: number;
  lat: number;
  date: string;
  after_end: boolean;
}

// Replay duration scales with check-in count: 2s for sparse games (~100
// check-ins) up to 10s for dense ones (~500+ across all units).
const REPLAY_MIN_MS = 2000;
const REPLAY_MAX_MS = 10000;
const REPLAY_MS_PER_CHECKIN = 20;
// Brief pause at the end of replay before reverting to the "show everything"
// view, so the user sees the completed picture before it stops being highlighted.
const REPLAY_HOLD_MS = 600;

interface TeamRef {
  name: string;
  color: string;
}

export interface JourneyEntry {
  rank: number;
  team: TeamRef | null;
  journey: JourneyPoint[];
}

interface JourneyMapProps {
  entries: JourneyEntry[];
  maptilerKey: string;
}

// Fallback colours for units that have no team. Picked to be distinguishable
// from each other and to read well on the dataviz basemap.
const FALLBACK_PALETTE = [
  '#e8a030',
  '#3b6ea5',
  '#7b8fa1',
  '#c94c35',
  '#5a7a3a',
  '#8a4f8a',
];

function colourFor(entry: JourneyEntry): string {
  return (
    entry.team?.color ?? FALLBACK_PALETTE[entry.rank % FALLBACK_PALETTE.length]
  );
}

function getBounds(
  points: [number, number][],
): [[number, number], [number, number]] {
  const lngs = points.map(([lng]) => lng);
  const lats = points.map(([, lat]) => lat);
  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ];
}

export default function JourneyMap({ entries, maptilerKey }: JourneyMapProps) {
  const { t } = useTranslation();
  const mapRef = useRef<MapRef>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const initialFitDone = useRef(false);

  // Pre-parse each check-in's date once so the replay loop doesn't reparse
  // strings on every animation frame.
  const indexedEntries = useMemo(
    () =>
      entries.map((e) => ({
        ...e,
        journey: e.journey.map((p) => ({
          ...p,
          t: new Date(p.date).getTime(),
        })),
      })),
    [entries],
  );

  const allPoints = useMemo<[number, number][]>(
    () =>
      indexedEntries.flatMap((e) =>
        e.journey.map((p) => [p.lng, p.lat] as [number, number]),
      ),
    [indexedEntries],
  );

  const timeBounds = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const e of indexedEntries) {
      for (const p of e.journey) {
        if (p.t < min) min = p.t;
        if (p.t > max) max = p.t;
      }
    }
    return { min, max };
  }, [indexedEntries]);

  const totalCheckins = useMemo(
    () => indexedEntries.reduce((s, e) => s + e.journey.length, 0),
    [indexedEntries],
  );

  const replayDurationMs = Math.max(
    REPLAY_MIN_MS,
    Math.min(REPLAY_MAX_MS, totalCheckins * REPLAY_MS_PER_CHECKIN),
  );

  // null = show everything (default). A timestamp = show only points dated
  // ≤ cursor; the RAF loop advances this from min to max time.
  const [replayCursor, setReplayCursor] = useState<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const holdTimeoutRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (holdTimeoutRef.current !== null)
        window.clearTimeout(holdTimeoutRef.current);
    },
    [],
  );

  const isReplaying = replayCursor !== null;

  const startReplay = useCallback(() => {
    if (
      timeBounds.min === Infinity ||
      timeBounds.max === timeBounds.min ||
      isReplaying
    )
      return;
    const { min, max } = timeBounds;
    const wallStart = performance.now();
    setReplayCursor(min);
    const tick = (now: number) => {
      const t = Math.min(1, (now - wallStart) / replayDurationMs);
      setReplayCursor(min + (max - min) * t);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
        holdTimeoutRef.current = window.setTimeout(() => {
          setReplayCursor(null);
          holdTimeoutRef.current = null;
        }, REPLAY_HOLD_MS);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [timeBounds, isReplaying, replayDurationMs]);

  // Single GeoJSON for both line variants and markers — colour is encoded as a
  // feature property and pulled out by the layer paint expression. One source,
  // three layers — scales to thousands of points without per-feature React work.
  // During replay, each unit's journey is sliced to points dated ≤ cursor.
  const featureCollection = useMemo(() => {
    type Feature =
      | {
          type: 'Feature';
          geometry: { type: 'LineString'; coordinates: [number, number][] };
          properties: { color: string; after_end: boolean };
        }
      | {
          type: 'Feature';
          geometry: { type: 'Point'; coordinates: [number, number] };
          properties: { color: string; after_end: boolean; date: string };
        };

    const features: Feature[] = [];
    const cursor = replayCursor ?? Infinity;

    for (const entry of indexedEntries) {
      if (entry.journey.length === 0) continue;
      const visible =
        cursor === Infinity
          ? entry.journey
          : entry.journey.filter((p) => p.t <= cursor);
      if (visible.length === 0) continue;
      const color = colourFor(entry);

      // Split the route at the first post-end point. Post-end line includes
      // the last in-game point too so the path stays visually continuous.
      const firstAfter = visible.findIndex((p) => p.after_end);
      const splitAt = firstAfter === -1 ? visible.length : firstAfter;

      const inGame = visible.slice(0, splitAt);
      const postEnd =
        firstAfter === -1 ? [] : visible.slice(Math.max(0, splitAt - 1));

      if (inGame.length > 1) {
        features.push({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: inGame.map((p) => [p.lng, p.lat]),
          },
          properties: { color, after_end: false },
        });
      }
      if (postEnd.length > 1) {
        features.push({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: postEnd.map((p) => [p.lng, p.lat]),
          },
          properties: { color, after_end: true },
        });
      }

      for (const p of visible) {
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
          properties: { color, after_end: p.after_end, date: p.date },
        });
      }
    }

    return { type: 'FeatureCollection' as const, features };
  }, [indexedEntries, replayCursor]);

  useEffect(() => {
    if (!mapLoaded || initialFitDone.current || allPoints.length === 0) return;
    initialFitDone.current = true;
    if (allPoints.length === 1) {
      mapRef.current?.jumpTo({ center: allPoints[0], zoom: 8 });
    } else {
      mapRef.current?.fitBounds(getBounds(allPoints), {
        padding: 40,
        animate: false,
      });
    }
  }, [mapLoaded, allPoints]);

  if (allPoints.length === 0) {
    return (
      <p className="rounded-card border border-char/10 bg-linen/60 px-4 py-6 text-center text-sm text-char/60">
        {t('game.leaderboard.mapEmpty')}
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-card border border-char/10">
      <div className="relative h-[450px] w-full">
        <ReactMap
          ref={mapRef}
          mapStyle={`https://api.maptiler.com/maps/dataviz/style.json?key=${maptilerKey}`}
          initialViewState={{ longitude: 0, latitude: 20, zoom: 1 }}
          onLoad={() => setMapLoaded(true)}
          style={{ width: '100%', height: '100%' }}
          attributionControl={false}
        >
          <Source id="journeys" type="geojson" data={featureCollection}>
            <Layer
              id="journey-line-in-game"
              type="line"
              filter={[
                'all',
                ['==', ['geometry-type'], 'LineString'],
                ['!', ['get', 'after_end']],
              ]}
              paint={{
                'line-color': ['get', 'color'],
                'line-width': 2.5,
                'line-opacity': 0.85,
              }}
              layout={{ 'line-join': 'round', 'line-cap': 'round' }}
            />
            <Layer
              id="journey-line-after-end"
              type="line"
              filter={[
                'all',
                ['==', ['geometry-type'], 'LineString'],
                ['get', 'after_end'],
              ]}
              paint={{
                'line-color': ['get', 'color'],
                'line-width': 2,
                'line-opacity': 0.45,
                'line-dasharray': [2, 2],
              }}
              layout={{ 'line-join': 'round', 'line-cap': 'round' }}
            />
            <Layer
              id="journey-markers"
              type="circle"
              filter={['==', ['geometry-type'], 'Point']}
              paint={{
                'circle-radius': ['case', ['get', 'after_end'], 4, 5],
                'circle-color': ['get', 'color'],
                'circle-opacity': ['case', ['get', 'after_end'], 0.55, 0.9],
                'circle-stroke-width': 1,
                'circle-stroke-color': '#ffffff',
              }}
            />
          </Source>
          <AttributionControl compact position="bottom-right" />
        </ReactMap>
      </div>
      <div className="flex items-center gap-4 bg-linen/60 px-4 py-2 text-xs text-char/70">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-6 rounded bg-char/70" />
          {t('game.leaderboard.mapDuringLegend')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-0.5 w-6 rounded opacity-50"
            style={{
              backgroundImage:
                'repeating-linear-gradient(to right, currentColor 0 4px, transparent 4px 8px)',
            }}
          />
          {t('game.leaderboard.mapAfterEndLegend')}
        </span>
        <button
          type="button"
          onClick={startReplay}
          disabled={isReplaying}
          className="ml-auto rounded-btn bg-amber px-3 py-1 text-xs font-medium tracking-wide text-char transition-transform hover:-translate-y-px active:translate-y-0 disabled:pointer-events-none disabled:opacity-60"
        >
          {isReplaying
            ? t('game.leaderboard.mapReplaying')
            : t('game.leaderboard.mapReplay')}
        </button>
      </div>
    </div>
  );
}
