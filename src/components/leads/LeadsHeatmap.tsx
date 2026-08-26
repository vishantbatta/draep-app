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

/** pin → [lat, lng, area] for every pin code observed in the lead dump. */
const PIN_GEO: Record<string, [number, number, string]> = {
  "560002": [12.9716, 77.5946, "Ashok Nagar"],
  "560003": [12.9758, 77.6045, "Shivajinagar"],
  "560004": [12.9791, 77.6100, "Bharathi Nagar"],
  "560008": [12.981, 77.587, "Malleshwaram"],
  "560011": [12.9719, 77.5942, "Bangalore East"],
  "560016": [12.9591, 77.617, "Jayanagar East"],
  "560017": [12.953, 77.625, "J.P. Nagar Phase 1"],
  "560022": [12.9352, 77.6245, "BTM Layout 1st Stage"],
  "560024": [12.9698, 77.75, "Whitefield"],
  "560032": [12.927, 77.622, "BTM Layout 2nd Stage"],
  "560035": [12.917, 77.635, "Bommanahalli"],
  "560036": [12.9698, 77.748, "ITPL Road"],
  "560037": [12.9591, 77.697, "Marathahalli"],
  "560038": [12.9516, 77.696, "Kadubeesanahalli"],
  "560043": [12.9698, 77.75, "Garudachar Palya"],
  "560045": [12.9256, 77.587, "Girinagar"],
  "560048": [12.96, 77.57, "Rajajinagar"],
  "560049": [12.906, 77.589, "Kumaraswamy Layout"],
  "560050": [12.98, 77.54, "Yeshwanthpur"],
  "560051": [12.987, 77.555, "Peenya"],
  "560054": [12.973, 77.632, "CV Raman Nagar"],
  "560061": [12.98, 77.639, "Banaswadi"],
  "560064": [12.978, 77.641, "Kalyan Nagar"],
  "560066": [12.984, 77.576, "Rajajinagar Industrial"],
  "560067": [12.99, 77.556, "Peenya Industrial"],
  "560068": [13.013, 77.647, "Hebbal"],
  "560070": [12.973, 77.658, "Dodda Banaswadi"],
  "560076": [12.984, 77.702, "Mahadevapura"],
  "560077": [12.967, 77.71, "Budigere Cross"],
  "560078": [13.0358, 77.597, "Yelahanka New Town"],
  "560087": [12.97, 77.74, "Whitefield Main"],
  "560091": [12.915, 77.62, "Mico Layout"],
  "560099": [12.955, 77.69, "Ramamurthy Nagar"],
  "560100": [12.919, 77.632, "Hulimavu"],
  "560102": [12.95, 77.68, "KR Puram"],
  "560103": [13.04, 77.58, "Yelahanka Old Town"],
};

/** Raw lead dump: one entry per lead. */
const LEAD_PINS = [
  "560099","560011","560054","560087","560078","560068","560064","560043","560070","560054",
  "560043","560061","560103","560077","560037","560036","560037","560078","560064","560008",
  "560070","560024","560077","560066","560016","560017","560011","560003","560064","560036",
  "560050","560076","560037","560064","560051","560024","560045","560003","560008","560032",
  "560038","560037","560043","560048","560004","560022","560100","560091","560035","560049",
  "560064","560078","560002","560076","560036","560102","560068","560099","560067",
];

const CENTER: LType.LatLngTuple = [12.9716, 77.665];
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
