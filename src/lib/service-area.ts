/**
 * V0 service area — Bangalore neighborhoods (spec §1, §6.10).
 *
 * TODO(ops): spec §13 leaves the polygon source open. For V0 we use a
 * bounding-box check around the known neighborhoods. This is intentionally
 * permissive — confirm boundaries before launch.
 */

export interface ServiceAreaResult {
  serviceable: boolean;
  areaName: string | null;
}

// Approximate centers of V0 neighborhoods (lat, lng).
// Spec §6.10 calls for polygon/radius from backend config.
const NEIGHBORHOODS: { name: string; lat: number; lng: number; radiusKm: number }[] = [
  { name: "Harlur", lat: 12.9116, lng: 77.6655, radiusKm: 2.5 },
  { name: "HSR Layout", lat: 12.9116, lng: 77.6474, radiusKm: 2.5 },
  { name: "Sarjapur", lat: 12.9279, lng: 77.6878, radiusKm: 3.0 },
  { name: "Kasavanahalli", lat: 12.9352, lng: 77.6965, radiusKm: 2.0 },
];

function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function checkServiceArea(lat?: number, lng?: number): ServiceAreaResult {
  if (lat == null || lng == null) return { serviceable: false, areaName: null };
  for (const n of NEIGHBORHOODS) {
    if (haversineKm(lat, lng, n.lat, n.lng) <= n.radiusKm) {
      return { serviceable: true, areaName: n.name };
    }
  }
  return { serviceable: false, areaName: null };
}

/** Used for pincode pre-validation — quick reject for pincodes outside Bangalore. */
export const BANGALORE_PINCODE_PREFIXES = ["560"];
