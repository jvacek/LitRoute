import 'maplibre-gl/dist/maplibre-gl.css';
import type { RefObject } from 'react';
import { useMemo } from 'react';
import ReactMap, { Layer, Source } from 'react-map-gl/maplibre';
import type { MapRef } from 'react-map-gl/maplibre';
import { brandColors } from '../lib/brandColors';

interface FreeformLocationMapProps {
  maptilerKey: string;
  pickedLatLng: [number, number] | null;
  interactive: boolean;
  mapRef?: RefObject<MapRef | null>;
  onPinSet?: (lat: number, lng: number) => void;
}

export default function FreeformLocationMap({
  maptilerKey,
  pickedLatLng,
  interactive,
  mapRef,
  onPinSet,
}: FreeformLocationMapProps) {
  const pinGeoJSON = useMemo(() => {
    if (!pickedLatLng)
      return { type: 'FeatureCollection' as const, features: [] };
    const [lat, lng] = pickedLatLng;
    return {
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [lng, lat] },
          properties: {},
        },
      ],
    };
  }, [pickedLatLng]);

  return (
    <div className="overflow-hidden rounded-card border border-char/10">
      <ReactMap
        ref={mapRef}
        mapStyle={`https://api.maptiler.com/maps/dataviz/style.json?key=${maptilerKey}`}
        initialViewState={{
          longitude: pickedLatLng ? pickedLatLng[1] : 6,
          latitude: pickedLatLng ? pickedLatLng[0] : 41,
          zoom: pickedLatLng ? (interactive ? 8 : 12) : 3,
        }}
        style={{ height: interactive ? '320px' : '240px', width: '100%' }}
        interactive={interactive}
        cursor={interactive ? 'crosshair' : undefined}
        attributionControl={interactive ? undefined : false}
        onClick={
          interactive && onPinSet
            ? (e) => {
                const { lng, lat } = e.lngLat;
                onPinSet(lat, lng);
              }
            : undefined
        }
      >
        <Source id="pin" type="geojson" data={pinGeoJSON}>
          <Layer
            id="pin-circle"
            type="circle"
            paint={{
              'circle-radius': 10,
              'circle-color': brandColors.amber,
              'circle-opacity': 0.9,
              'circle-stroke-width': 2,
              'circle-stroke-color': brandColors.white,
            }}
          />
        </Source>
      </ReactMap>
    </div>
  );
}
