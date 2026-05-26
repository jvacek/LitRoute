import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMap, { Layer, Marker, Source } from 'react-map-gl/maplibre';
import { brandColors } from '../lib/brandColors';
import { clampToCircle } from '../lib/haversine';
import { geodesicCirclePolygon, zoomForDriftRadius } from '../lib/maps';
import { primaryBtnLg } from '../styles';

export type ConfirmStep = {
  gpsLat: number;
  gpsLng: number;
  pinLat: number;
  pinLng: number;
  accuracyM: number;
} | null;

interface GpsConfirmMapProps {
  maptilerKey: string;
  gpsDriftFloorM: number;
  confirmStep: ConfirmStep;
  capturing: boolean;
  onCapture: () => void;
  onSelectPin: (pinLat: number, pinLng: number) => void;
  onReset: () => void;
}

export default function GpsConfirmMap({
  maptilerKey,
  gpsDriftFloorM,
  confirmStep,
  capturing,
  onCapture,
  onSelectPin,
  onReset,
}: GpsConfirmMapProps) {
  const { t } = useTranslation();
  // Animated pin position used only during the snap-to-edge animation.
  // null = no animation running; Marker renders from confirmStep directly.
  const [snapAnim, setSnapAnim] = useState<{ lat: number; lng: number } | null>(
    null,
  );
  const snapRafRef = useRef<number>(0);

  useEffect(() => () => cancelAnimationFrame(snapRafRef.current), []);

  function runSnapAnim(
    fromLat: number,
    fromLng: number,
    toLat: number,
    toLng: number,
  ) {
    cancelAnimationFrame(snapRafRef.current);
    // Show the drop position on the first frame so the user sees the pin
    // "try" to land outside before it bounces back to the edge.
    setSnapAnim({ lat: fromLat, lng: fromLng });
    const t0 = performance.now();
    const DURATION = 350;
    function tick(now: number) {
      const p = Math.min((now - t0) / DURATION, 1);
      const ease = 1 - (1 - p) ** 3; // ease-out cubic
      setSnapAnim({
        lat: fromLat + (toLat - fromLat) * ease,
        lng: fromLng + (toLng - fromLng) * ease,
      });
      if (p < 1) {
        snapRafRef.current = requestAnimationFrame(tick);
      } else {
        setSnapAnim(null);
      }
    }
    snapRafRef.current = requestAnimationFrame(tick);
  }

  // Mirrors the server-side rule `max(game.gps_drift_floor, gps_accuracy_m)`
  // so a user with a coarse fix can nudge their pin anywhere inside their
  // accuracy circle (and the drawn circle reflects what the server will
  // actually accept). Falls back to the floor while there's no fix yet.
  const effectiveDriftM = confirmStep
    ? Math.max(gpsDriftFloorM, confirmStep.accuracyM)
    : gpsDriftFloorM;

  const confirmCircleGeoJSON = useMemo(() => {
    if (!confirmStep)
      return { type: 'FeatureCollection' as const, features: [] };
    return {
      type: 'FeatureCollection' as const,
      features: [
        geodesicCirclePolygon(
          confirmStep.gpsLat,
          confirmStep.gpsLng,
          effectiveDriftM,
        ),
      ],
    };
  }, [confirmStep, effectiveDriftM]);

  function handleNudge(lat: number, lng: number) {
    if (!confirmStep) return;
    const [clampedLat, clampedLng] = clampToCircle(
      confirmStep.gpsLat,
      confirmStep.gpsLng,
      effectiveDriftM,
      lat,
      lng,
    );
    onSelectPin(clampedLat, clampedLng);
    if (clampedLat !== lat || clampedLng !== lng) {
      runSnapAnim(lat, lng, clampedLat, clampedLng);
    }
  }

  return (
    <>
      <div className="overflow-hidden rounded-card border border-char/10">
        {confirmStep ? (
          <ReactMap
            mapStyle={`https://api.maptiler.com/maps/dataviz/style.json?key=${maptilerKey}`}
            initialViewState={{
              longitude: confirmStep.gpsLng,
              latitude: confirmStep.gpsLat,
              zoom: zoomForDriftRadius(effectiveDriftM, confirmStep.gpsLat),
            }}
            style={{ height: '240px', width: '100%' }}
            onClick={(e) => handleNudge(e.lngLat.lat, e.lngLat.lng)}
          >
            <Source
              id="confirm-circle"
              type="geojson"
              data={confirmCircleGeoJSON}
            >
              <Layer
                id="confirm-circle-fill"
                type="fill"
                paint={{
                  'fill-color': brandColors.amber,
                  'fill-opacity': 0.15,
                }}
              />
              <Layer
                id="confirm-circle-line"
                type="line"
                paint={{ 'line-color': brandColors.amber, 'line-width': 2 }}
              />
            </Source>
            <Marker
              longitude={confirmStep.gpsLng}
              latitude={confirmStep.gpsLat}
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: brandColors.smoke,
                  border: `2px solid ${brandColors.white}`,
                  pointerEvents: 'none',
                }}
              />
            </Marker>
            <Marker
              longitude={snapAnim?.lng ?? confirmStep.pinLng}
              latitude={snapAnim?.lat ?? confirmStep.pinLat}
              draggable
              onDragStart={() => {
                cancelAnimationFrame(snapRafRef.current);
                setSnapAnim(null);
              }}
              onDragEnd={(e) => handleNudge(e.lngLat.lat, e.lngLat.lng)}
            >
              <div
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  background: brandColors.amber,
                  border: `2px solid ${brandColors.white}`,
                  cursor: 'grab',
                }}
              />
            </Marker>
          </ReactMap>
        ) : (
          <div className="relative" style={{ height: '240px' }}>
            {/* Non-interactive map at a wide view so the placeholder
                visually reads as "map" before GPS capture. */}
            <ReactMap
              mapStyle={`https://api.maptiler.com/maps/dataviz/style.json?key=${maptilerKey}`}
              initialViewState={{ longitude: 6, latitude: 41, zoom: 3 }}
              style={{ height: '240px', width: '100%' }}
              interactive={false}
              attributionControl={false}
            />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6">
              <div className="pointer-events-auto flex max-w-sm flex-col items-center gap-3 rounded-card bg-white/95 px-5 py-4 text-center shadow-md">
                <p className="text-sm text-char">
                  {t('checkin.form.gpsNotice')}
                </p>
                <button
                  type="button"
                  onClick={onCapture}
                  disabled={capturing}
                  className={primaryBtnLg}
                >
                  {capturing
                    ? `${t('checkin.form.useMyLocation.loading')}…`
                    : t('checkin.form.useMyLocation.default')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {confirmStep && (
        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="text-xs text-smoke">{t('checkin.form.gpsNudgeHint')}</p>
          <button
            type="button"
            onClick={onReset}
            className="shrink-0 text-xs text-smoke underline hover:text-char"
          >
            {t('checkin.form.useMyLocation.default')}
          </button>
        </div>
      )}
    </>
  );
}
