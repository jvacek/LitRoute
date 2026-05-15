import 'maplibre-gl/dist/maplibre-gl.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMap, {
  AttributionControl,
  Layer,
  Source,
} from 'react-map-gl/maplibre';
import type { MapRef } from 'react-map-gl/maplibre';

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

function parseLatLng(loc: GeoPoint): [number, number] {
  return [loc.coordinates[1], loc.coordinates[0]]; // GeoJSON is [lng, lat]; return [lat, lng]
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

export default function UnitMap({
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
