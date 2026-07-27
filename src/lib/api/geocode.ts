/**
 * Lightweight client-side geocoding via OpenStreetMap Nominatim.
 *
 * Why client-side (not via our FastAPI backend):
 *   - No API key required (Nominatim is free for low-volume use).
 *   - No backend route, dependency, or caching to maintain.
 *   - We already use OSM raster tiles for the map, so this is the same provider.
 *
 * Usage policy: we send a descriptive `Referer`/`User-Agent`-style header where
 * possible and limit to 1 result. The contact form fires at most one request
 * per debounced pincode entry, well under Nominatim's rate limit.
 *
 * Docs: https://nominatim.org/release-docs/develop/api/Search/
 */

export interface GeocodeResult {
  lat: number;
  lng: number;
  label: string;
}

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
}

const ENDPOINT = "https://nominatim.openstreetmap.org/search";

/**
 * Resolve an Indian pincode (e.g. "560102") to a lat/lng centroid.
 * Returns `null` if no match was found or the request failed — callers
 * should treat that as "no-op, let the user place the pin manually".
 */
export async function geocodePincode(pincode: string): Promise<GeocodeResult | null> {
  const code = pincode.trim();
  if (!/^\d{6}$/.test(code)) return null;

  const url =
    `${ENDPOINT}?` +
    new URLSearchParams({
      countrycodes: "in",
      postalcode: code,
      format: "json",
      limit: "1",
      "accept-language": "en",
    }).toString();

  try {
    const res = await fetch(url, {
      headers: {
        // Nominatim usage policy asks for a identifying header.
        Referer: typeof window !== "undefined" ? window.location.origin : "https://draep.app",
      },
      // Don't send cookies — Nominatim is a third-party public service.
      credentials: "omit",
      cache: "no-store",
    });
    if (!res.ok) return null;

    const data = (await res.json()) as NominatimResult | NominatimResult[];
    const first = Array.isArray(data) ? data[0] : data;
    if (!first || !first.lat || !first.lon) return null;

    const lat = Number(first.lat);
    const lng = Number(first.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    return {
      lat: Number(lat.toFixed(6)),
      lng: Number(lng.toFixed(6)),
      label: first.display_name,
    };
  } catch {
    return null;
  }
}
