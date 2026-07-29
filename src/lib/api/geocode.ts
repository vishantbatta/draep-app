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

/** Extended result with parsed address parts for autofill. */
export interface GeocodeAddressResult extends GeocodeResult {
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  pincode?: string;
}

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
  address?: {
    house_number?: string;
    road?: string;
    neighbourhood?: string;
    suburb?: string;
    city_district?: string;
    city?: string;
    town?: string;
    village?: string;
    county?: string;
    state?: string;
    postcode?: string;
    country?: string;
  };
}

interface NominatimReverseResult {
  lat: string;
  lon: string;
  display_name: string;
  address?: NominatimResult["address"];
}

const ENDPOINT = "https://nominatim.openstreetmap.org/search";
const REVERSE_ENDPOINT = "https://nominatim.openstreetmap.org/reverse";

/**
 * Parse a Nominatim address object into our address-line fields.
 * Best-effort — Nominatim's address schema varies by region.
 */
function parseAddressParts(addr: NominatimResult["address"] | undefined): {
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  pincode?: string;
} {
  if (!addr) return {};

  // Line 1: house number + road
  const line1Parts = [addr.house_number, addr.road].filter(Boolean);
  const addressLine1 = line1Parts.length > 0 ? line1Parts.join(" ") : undefined;

  // Line 2: neighbourhood / suburb / city_district
  const addressLine2 =
    addr.neighbourhood ?? addr.suburb ?? addr.city_district ?? undefined;

  // City: prefer city, then town, then village, then county
  const city = addr.city ?? addr.town ?? addr.village ?? addr.county ?? undefined;

  return {
    addressLine1,
    addressLine2,
    city,
    state: addr.state,
    pincode: addr.postcode,
  };
}

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

/**
 * Free-text address search (like Google Maps typing).
 * Returns up to 5 results with parsed address parts for autofill.
 *
 * Used by the admin order creation flow — admin types an address,
 * picks from the dropdown, and the form fields + map pin auto-populate.
 */
export async function searchAddresses(
  query: string,
): Promise<GeocodeAddressResult[]> {
  const q = query.trim();
  if (q.length < 3) return [];

  const url =
    `${ENDPOINT}?` +
    new URLSearchParams({
      q,
      countrycodes: "in",
      format: "json",
      limit: "5",
      "accept-language": "en",
      addressdetails: "1",
    }).toString();

  try {
    const res = await fetch(url, {
      headers: {
        Referer:
          typeof window !== "undefined"
            ? window.location.origin
            : "https://draep.app",
      },
      credentials: "omit",
      cache: "no-store",
    });
    if (!res.ok) return [];

    const data = (await res.json()) as NominatimResult[];
    if (!Array.isArray(data)) return [];

    return data
      .map((r) => {
        const lat = Number(r.lat);
        const lng = Number(r.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        return {
          lat: Number(lat.toFixed(6)),
          lng: Number(lng.toFixed(6)),
          label: r.display_name,
          ...parseAddressParts(r.address),
        } as GeocodeAddressResult;
      })
      .filter((x): x is GeocodeAddressResult => x !== null);
  } catch {
    return [];
  }
}

/**
 * Reverse geocode: lat/lng → address parts.
 * Used when the admin drags the pin to autofill the address fields.
 */
export async function reverseGeocode(
  lat: number,
  lng: number,
): Promise<GeocodeAddressResult | null> {
  const url =
    `${REVERSE_ENDPOINT}?` +
    new URLSearchParams({
      lat: String(lat),
      lon: String(lng),
      format: "json",
      "accept-language": "en",
      addressdetails: "1",
      zoom: "18",
    }).toString();

  try {
    const res = await fetch(url, {
      headers: {
        Referer:
          typeof window !== "undefined"
            ? window.location.origin
            : "https://draep.app",
      },
      credentials: "omit",
      cache: "no-store",
    });
    if (!res.ok) return null;

    const data = (await res.json()) as NominatimReverseResult;
    if (!data || !data.lat || !data.lon) return null;

    return {
      lat: Number(data.lat),
      lng: Number(data.lon),
      label: data.display_name,
      ...parseAddressParts(data.address),
    };
  } catch {
    return null;
  }
}
