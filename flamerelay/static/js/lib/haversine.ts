const EARTH_RADIUS_M = 6_371_000;

/**
 * If (lat, lng) is within radiusM of (centerLat, centerLng), return it unchanged.
 * Otherwise snap it to the nearest point on the circle edge by projecting along
 * the bearing from center to the attempted point.
 */
export function clampToCircle(
  centerLat: number,
  centerLng: number,
  radiusM: number,
  lat: number,
  lng: number,
): [number, number] {
  const φ1 = (centerLat * Math.PI) / 180;
  const λ1 = (centerLng * Math.PI) / 180;
  const φ2 = (lat * Math.PI) / 180;
  const λ2 = (lng * Math.PI) / 180;
  const dLat = φ2 - φ1;
  const dLng = λ2 - λ1;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(dLng / 2) ** 2;
  const dist = EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  if (dist <= radiusM) return [lat, lng];

  const bearing = Math.atan2(
    Math.sin(dLng) * Math.cos(φ2),
    Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dLng),
  );
  const d = radiusM / EARTH_RADIUS_M;
  const φ3 = Math.asin(
    Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(bearing),
  );
  const λ3 =
    λ1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(d) * Math.cos(φ1),
      Math.cos(d) - Math.sin(φ1) * Math.sin(φ3),
    );
  return [(φ3 * 180) / Math.PI, (λ3 * 180) / Math.PI];
}

const EARTH_RADIUS_KM = 6371;

export function haversineM(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function haversineKm(a: [number, number], b: [number, number]): number {
  const [lat1, lng1] = a;
  const [lat2, lng2] = b;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const t =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(t), Math.sqrt(1 - t));
}
