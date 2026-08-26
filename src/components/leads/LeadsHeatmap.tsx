"use client";

/**
 * LeadsHeatmap — Bangalore lead density by pin code.
 *
 * Vanilla Leaflet in a single useEffect (same approach as LeafletMapPicker —
 * no react-leaflet). Heat intensity is rendered with radius-weighted circle
 * markers rather than the leaflet.heat plugin, so no new dependency.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type * as LType from "leaflet";
// NOTE: leaflet/dist/leaflet.css is imported once in src/styles/globals.css.

/**
 * pin → [lat, lng, area] for every pin code observed in the lead dump.
 *
 * Coordinates are geocoded from the India Post post-office name for each pin
 * (source: GeoNames IN postal data → OSM Nominatim). Two pins are hand-placed
 * where OSM had no match: 560035 (interpolated on Sarjapur Rd) and 560077
 * (Kothanur near Thanisandra — Nominatim resolved the wrong Kothanahalli).
 */
const PIN_GEO: Record<string, [number, number, string]> = {
  "560002": [13.02223, 77.56718, "Bangalore City"],
  "560003": [13.00274, 77.57033, "Malleswaram"],
  "560013": [13.03941, 77.51974, "Jalahalli"],
  "560023": [12.97565, 77.55535, "Magadi Road"],
  "560004": [12.94173, 77.5755, "Basavanagudi"],
  "560008": [12.96092, 77.63879, "HAL II Stage"],
  "560011": [12.93386, 77.58303, "Jayanagar 3rd Block"],
  "560016": [13.01202, 77.67778, "Ramamurthy Nagar"],
  "560017": [12.96218, 77.66355, "Vimanapura"],
  "560022": [13.01769, 77.5555, "Yeshwanthpur"],
  "560024": [13.05019, 77.6076, "Hebbal Kempapura"],
  "560032": [13.02542, 77.59601, "R T Nagar"],
  "560035": [12.9035, 77.7001, "Carmelram (Sarjapur Rd)"],
  "560036": [13.00055, 77.67546, "Krishnarajapuram"],
  "560037": [12.97759, 77.71556, "Kundalahalli"],
  "560038": [12.97329, 77.64047, "Indiranagar"],
  "560043": [13.01416, 77.65185, "Banaswadi"],
  "560045": [13.03001, 77.62088, "Arabic College"],
  "560046": [12.99734, 77.60368, "Benson Town"],
  "560048": [12.99592, 77.71928, "Hoodi"],
  "560049": [13.05377, 77.71733, "Virgonagar"],
  "560050": [12.92782, 77.55662, "Banashankari"],
  "560051": [12.99103, 77.57793, "Kumara Park West"],
  "560054": [13.03336, 77.55818, "Mathikere"],
  "560061": [12.89926, 77.53217, "Subramanyapura"],
  "560064": [13.09889, 77.58065, "Yelahanka Satellite Town"],
  "560066": [12.99574, 77.75795, "Whitefield"],
  "560067": [12.97936, 77.79073, "Samethanahalli"],
  "560068": [12.90346, 77.623, "Bommanahalli"],
  "560070": [12.9181, 77.55766, "Padmanabhanagar"],
  "560076": [12.87735, 77.6028, "Hulimavu"],
  "560077": [13.075, 77.635, "Kothanur (Thanisandra)"],
  "560078": [12.90969, 77.58661, "JP Nagar"],
  "560087": [12.92098, 77.7361, "Gunjur"],
  "560091": [12.99123, 77.48701, "Herohalli"],
  "560099": [12.81602, 77.68922, "Bommasandra"],
  "560100": [12.88718, 77.61127, "Electronics City"],
  "560102": [12.91162, 77.63886, "HSR Layout"],
  "560103": [12.93205, 77.68429, "Bellandur"],
  "562107": [12.77512, 77.77092, "Attibele"],
};

/** Raw lead dump: one entry per lead. */
const LEAD_PINS = [
  "560099","560011","560054","560087","560078","560068","560064","560043","560070","560054",
  "560043","560061","560103","560077","560037","560036","560037","560078","560064","560008",
  "560070","560024","560077","560066","560016","560017","560011","560003","560064","560036",
  "560050","560076","560037","560064","560051","560024","560045","560003","560008","560032",
  "560038","560037","560043","560048","560004","560022","560100","560091","560035","560049",
  "560064","560078","560002","560076","560036","560102","560068","560099","560067",
  "560023","560076","560076","560078","560100","560064","560102","560064","560037",
  "560013","562107","560066","560046","560076",
];

// Centered south of the city so the Attibele outlier (562107) stays in view.
const CENTER: LType.LatLngTuple = [12.945, 77.665];
const ZOOM = 11;

/** Blue → cyan → green → amber → red, matched to the legend gradient. */
function intensityColor(t: number): string {
  const stops: Array<[number, [number, number, number]]> = [
    [0, [59, 130, 246]],
    [0.25, [34, 211, 238]],
    [0.5, [34, 197, 94]],
    [0.75, [234, 179, 8]],
    [1, [239, 68, 68]],
  ];
  for (let i = 1; i < stops.length; i++) {
    const [p1, c1] = stops[i - 1];
    const [p2, c2] = stops[i];
    if (t <= p2) {
      const f = (t - p1) / (p2 - p1);
      const mix = c1.map((v, k) => Math.round(v + f * (c2[k] - v)));
      return `rgb(${mix[0]},${mix[1]},${mix[2]})`;
    }
  }
  return "rgb(239,68,68)";
}

export function LeadsHeatmap() {
  const mapRef = useRef<LType.Map | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  /** pin → lead count, sorted descending. */
  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const p of LEAD_PINS) c.set(p, (c.get(p) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]);
  }, []);

  const maxCount = counts[0]?.[1] ?? 1;
  const totalLeads = LEAD_PINS.length;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let cancelled = false;
    let cleanup: (() => void) | undefined;

    // Leaflet touches `window` at import time — load it in the browser only.
    import("leaflet").then((mod) => {
      if (cancelled || !containerRef.current) return;
      const L = mod.default;

      const map = L.map(containerRef.current, { zoomControl: false }).setView(CENTER, ZOOM);
      L.control.zoom({ position: "topright" }).addTo(map);
      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
        maxZoom: 18,
      }).addTo(map);

      for (const [pin, count] of counts) {
        const geo = PIN_GEO[pin];
        if (!geo) continue;
        const t = count / maxCount;

        // Soft blurred halo = the "heat" reading; crisp dot = the exact pin.
        L.circleMarker([geo[0], geo[1]], {
          radius: 18 + t * 26,
          stroke: false,
          fillColor: intensityColor(t),
          fillOpacity: 0.28,
          interactive: false,
        }).addTo(map);

        L.circleMarker([geo[0], geo[1]], {
          radius: 5 + t * 8,
          fillColor: intensityColor(t),
          fillOpacity: 0.9,
          color: "#ffffff",
          weight: 1.5,
          opacity: 0.7,
        })
          .bindPopup(
            `<b>${pin}</b> — ${geo[2]}<br/><span style="font-size:18px;font-weight:700;">${count}</span> lead${count > 1 ? "s" : ""}`
          )
          .addTo(map);
      }

      mapRef.current = map;
      cleanup = () => {
        map.remove();
        mapRef.current = null;
      };
    });

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [counts, maxCount]);

  /** Fly to a pin when the user clicks a sidebar row. */
  useEffect(() => {
    const map = mapRef.current;
    const geo = selected ? PIN_GEO[selected] : undefined;
    if (map && geo) map.flyTo([geo[0], geo[1]], 14, { duration: 0.8 });
  }, [selected]);

  return (
    <div className="flex h-[100dvh] bg-slate-900 text-slate-200">
      <aside className="flex w-80 min-w-80 flex-col border-r border-slate-700 bg-slate-800">
        <div className="border-b border-slate-700 px-5 pb-4 pt-6">
          <h1 className="text-xl font-bold text-slate-50">📍 Bangalore Leads</h1>
          <p className="mt-1 text-sm text-slate-400">Pin code density map</p>
        </div>

        <div className="grid grid-cols-2 gap-2.5 border-b border-slate-700 px-5 py-4">
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-3.5">
            <div className="mb-1 text-xs uppercase tracking-wide text-slate-500">Total Leads</div>
            <div className="text-2xl font-bold text-slate-50">{totalLeads}</div>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-3.5">
            <div className="mb-1 text-xs uppercase tracking-wide text-slate-500">Pincodes</div>
            <div className="text-2xl font-bold text-amber-500">{counts.length}</div>
          </div>
        </div>

        <div className="px-5 pb-2 pt-4 text-xs font-semibold uppercase tracking-widest text-slate-500">
          Pincodes by Lead Count
        </div>

        <div className="flex-1 overflow-y-auto px-3 pb-4">
          {counts.map(([pin, count]) => (
            <button
              key={pin}
              onClick={() => setSelected(pin)}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left transition-colors ${
                selected === pin ? "bg-slate-600" : "hover:bg-slate-700"
              }`}
            >
              <span>
                <span className="block font-semibold tabular-nums">{pin}</span>
                <span className="block text-xs text-slate-400">{PIN_GEO[pin]?.[2] ?? "Unknown"}</span>
              </span>
              <span className="min-w-7 rounded-full bg-amber-500 px-2 py-0.5 text-center text-xs font-bold text-slate-900">
                {count}
              </span>
            </button>
          ))}
        </div>
      </aside>

      <div className="relative flex-1">
        <div ref={containerRef} className="h-full w-full" />
        <div className="absolute bottom-6 right-6 z-[1000] rounded-xl border border-slate-700 bg-slate-900/90 p-3.5 backdrop-blur">
          <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-500">
            Lead Intensity
          </div>
          <div className="h-2.5 w-44 rounded-full bg-gradient-to-r from-blue-500 via-cyan-400 via-green-500 to-red-500" />
          <div className="mt-1 flex justify-between text-xs text-slate-400">
            <span>Low</span>
            <span>High</span>
          </div>
        </div>
      </div>
    </div>
  );
}
