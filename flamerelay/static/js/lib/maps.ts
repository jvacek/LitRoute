import type { Feature, Polygon } from 'geojson';

// Accuracy threshold: readings coarser than this are retried (network positioning vs real GPS).
export const GPS_MAX_ACCURACY_M = 100;

// Web Mercator zoom that makes a circle of `radiusM` at `lat` cover ~60% of the
// confirm map's 240px height. Mercator m/px = 156543.03 * cos(lat) / 2^z.
export function zoomForDriftRadius(radiusM: number, lat: number): number {
  if (radiusM <= 0) return 16;
  const targetDiameterPx = 144;
  const metersPerPixel = (2 * radiusM) / targetDiameterPx;
  const z = Math.log2(
    (156_543.03 * Math.cos((lat * Math.PI) / 180)) / metersPerPixel,
  );
  return Math.max(10, Math.min(18, z));
}

export function geodesicCirclePolygon(
  lat: number,
  lng: number,
  radiusM: number,
  steps = 64,
): Feature<Polygon> {
  const R = 6_371_000;
  const pts: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * 2 * Math.PI;
    const dLat = (radiusM / R) * (180 / Math.PI) * Math.cos(angle);
    const dLng =
      ((radiusM / R) * (180 / Math.PI) * Math.sin(angle)) /
      Math.cos((lat * Math.PI) / 180);
    pts.push([lng + dLng, lat + dLat]);
  }
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [pts] },
    properties: {},
  };
}
