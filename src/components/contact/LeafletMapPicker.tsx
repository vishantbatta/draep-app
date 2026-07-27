"use client";

/**
 * LeafletMapPicker — vanilla Leaflet, no react-leaflet.
 *
 * Two structural decisions, each addressing a real bug observed in dev:
 *
 * 1. We use vanilla Leaflet inside a single useEffect instead of react-leaflet.
 *    react-leaflet v4 reconciles the <Marker position> prop on every render,
 *    which caused subtle position-fighting with the parent's state. Keeping
 *    React out of the marker's lifecycle removed that entire class of bugs.
 *
 * 2. We DISABLE Leaflet's built-in MarkerDrag (`draggable: false`) and
 *    implement dragging ourselves with document-level pointer events. In
 *    Chrome, the mousedown on our SVG-backed divIcon lands on the inner
 *    <circle>, and Leaflet's internal L.Draggable never properly engages —
 *    the marker would not move at all under real user input.
 *
 * 3. Stray-click guard. After a marker drag, the browser fires a synthetic
 *    `click` at the cursor's final screen position. Because the marker has
 *    moved away from under the cursor, that click often lands on the "Use
 *    my location" button (which sits at bottom-right of the map). Without
 *    the guard in `useMyLocation`, this re-triggers GPS and snaps the pin
 *    back to the user's GPS coordinates — the original "snap-back" bug.
 *    We suppress button clicks for 400ms after every marker drag.
 */

import { useEffect, useRef, useState } from "react";
import L, { type LatLngTuple } from "leaflet";
// NOTE: leaflet/dist/leaflet.css is imported once in src/styles/globals.css.

import { Crosshair, MapPin } from "@/components/ui/icons";
import { strings } from "@/lib/strings";

const DEFAULT_CENTER: LatLngTuple = [12.9116, 77.6564];
const DEFAULT_ZOOM = 13;

const pinIcon = L.divIcon({
  className: "draep-pin",
  html: `
    <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36"
         viewBox="0 0 24 24" fill="#ff5a1f" stroke="#ffffff"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 22s-7-7-7-12a7 7 0 0 1 14 0c0 5-7 12-7 12z"/>
      <circle cx="12" cy="10" r="2.5" fill="#ffffff"/>
    </svg>
  `,
  iconSize: [36, 36],
  iconAnchor: [18, 36],
  popupAnchor: [0, -36],
});

export interface LeafletMapPickerProps {
  lat?: number;
  lng?: number;
  onPinChange: (lat: number, lng: number) => void;
  /**
   * Externally-driven "fly to this location" command.
   *
   * The component watches `nonce` (not lat/lng) for changes — when `nonce`
   * bumps, it animates the map + marker to the given coordinates and emits
   * the new position via `onPinChange`.
   *
   * The nonce pattern is what prevents feedback loops: a pincode geocode
   * sets a fresh nonce, which moves the marker, which fires `onPinChange`,
   * which updates the parent's `pin` state — but the parent doesn't bump
   * the nonce in response, so we don't re-fly.
   *
   * Set to `undefined` or omit to disable.
   */
  flyTo?: { lat: number; lng: number; nonce: number };
}

export function LeafletMapPicker({ lat, lng, onPinChange, flyTo }: LeafletMapPickerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  // React-side UI state only — never fed back into Leaflet.
  const [readOut, setReadOut] = useState<LatLngTuple>(() =>
    lat != null && lng != null ? [lat, lng] : DEFAULT_CENTER,
  );
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [geoInfo, setGeoInfo] = useState<string | null>(null);

  // Refs that the Leaflet-side code (inside the mount effect) needs to
  // reach back into. We don't put these in deps so the effect runs once.
  const onPinChangeRef = useRef(onPinChange);
  onPinChangeRef.current = onPinChange;

  // Map + marker handles — kept in refs so the geolocation handler and
  // any other imperative code can reach them.
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const lastEmittedRef = useRef<string>("");

  // After a marker drag, the browser fires a synthetic `click` at the cursor's
  // final position. Because the marker has moved away from under the cursor,
  // that click often lands on the "Use my location" button (which sits at the
  // bottom-right of the map). Without suppression, this re-triggers GPS,
  // snapping the pin back to the user's GPS coordinates — the original
  // "snap-back" bug. We record the end-of-drag timestamp and have the button
  // ignore clicks that arrive within a short window afterwards.
  const suppressClickUntilRef = useRef<number>(0);

  // ─── Mount: create map, marker, wire events. Cleanup on unmount. ──────────
  useEffect(() => {
    if (!containerRef.current) return;

    const start: LatLngTuple =
      lat != null && lng != null ? [lat, lng] : DEFAULT_CENTER;

    const map = L.map(containerRef.current, {
      center: start,
      zoom: DEFAULT_ZOOM,
      scrollWheelZoom: false,
      zoomControl: true,
    });
    mapRef.current = map;

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);

    // NOTE: `draggable: false` — we intentionally DISABLE Leaflet's built-in
    // MarkerDrag handler. In real browsers (Chrome) the mousedown lands on the
    // inner <svg>/<circle> child of our divIcon, and Leaflet's internal
    // L.Draggable never properly engages, so the marker doesn't move. We
    // implement dragging ourselves below using document-level mouse listeners
    // and marker.setLatLng(). This is immune to SVG-event bubbling issues.
    const marker = L.marker(start, {
      icon: pinIcon,
      draggable: false,
      autoPan: true,
    }).addTo(map);
    markerRef.current = marker;

    let lastDragEnd = 0;
    let lastDragStart = 0;

    // ── Manual marker drag (bypasses Leaflet's MarkerDrag) ───────────────
    // Attach a pointerdown handler to the marker's icon DOM element. Using
    // pointer events (not mousedown) so it works on touch + pen + mouse.
    const iconEl = marker.getElement?.();
    if (iconEl) {
      // Make it look draggable and set cursor.
      iconEl.style.cursor = "grab";
      iconEl.style.touchAction = "none";

      const onPointerDown = (e: PointerEvent) => {
        // Only primary button (left mouse / touch / pen).
        if (e.button !== 0 && e.pointerType === "mouse") return;
        e.preventDefault();
        e.stopPropagation();

        lastDragStart = Date.now();
        iconEl.style.cursor = "grabbing";

        const startClientX = e.clientX;
        const startClientY = e.clientY;
        const startLatLng = marker.getLatLng();
        let moved = false;

        // Capture pointer so we keep getting move events even outside the icon.
        let captured: number | null = null;
        try {
          captured = (iconEl as HTMLElement).setPointerCapture?.(e.pointerId) ?? null;
          if (typeof captured === "boolean" && captured === false) captured = null;
        } catch { captured = null; }
        // setPointerCapture returns void on some lib typings; try-catch guard.
        const hasCapture = captured !== null;

        const onPointerMove = (ev: PointerEvent) => {
          const dx = ev.clientX - startClientX;
          const dy = ev.clientY - startClientY;
          if (!moved && Math.hypot(dx, dy) < 3) return; // dead zone
          moved = true;

          // Convert the NEW desired pixel position to lat/lng.
          // Marker icon anchor is at [18, 36] (bottom-center). The current
          // marker latlng maps to that anchor point on screen. We compute the
          // new screen point of the anchor = old anchor screen point + delta.
          const mapEl = map.getContainer();
          const rect = mapEl.getBoundingClientRect();
          // Find where the marker anchor currently is in container coords.
          const anchorPt = map.latLngToContainerPoint(startLatLng);
          const newContainerX = anchorPt.x + dx;
          const newContainerY = anchorPt.y + dy;
          const newLatLng = map.containerPointToLatLng([
            newContainerX,
            newContainerY,
          ]);

          const next: LatLngTuple = [
            Number(newLatLng.lat.toFixed(6)),
            Number(newLatLng.lng.toFixed(6)),
          ];
          marker.setLatLng(next);
          // Update caption live.
          setReadOut(next);
        };

        const onPointerUp = (ev: PointerEvent) => {
          document.removeEventListener("pointermove", onPointerMove);
          document.removeEventListener("pointerup", onPointerUp);
          document.removeEventListener("pointercancel", onPointerUp);
          if (hasCapture) {
            try { (iconEl as HTMLElement).releasePointerCapture?.(ev.pointerId); } catch {}
          }
          iconEl.style.cursor = "grab";

          // Suppress the stray synthetic click that the browser dispatches
          // right after pointerup. Without this, the click lands on the
          // "Use my location" button (because the marker slid out from
          // under the cursor) and re-triggers GPS, snapping the pin back.
          // 400ms is more than enough for the browser to flush the click.
          suppressClickUntilRef.current = Date.now() + 400;

          const ll = marker.getLatLng();
          const next: LatLngTuple = [
            Number(ll.lat.toFixed(6)),
            Number(ll.lng.toFixed(6)),
          ];
          lastDragEnd = Date.now();
          lastEmittedRef.current = `${next[0]},${next[1]}`;
          setReadOut(next);
          onPinChangeRef.current(next[0], next[1]);
        };

        document.addEventListener("pointermove", onPointerMove, { passive: false });
        document.addEventListener("pointerup", onPointerUp);
        document.addEventListener("pointercancel", onPointerUp);
      };

      iconEl.addEventListener("pointerdown", onPointerDown);

      // Stash for cleanup.
      (iconEl as any).__draepPointerDown = onPointerDown;
    }

    // Click-to-place on the map (suppressed briefly after a drag).
    const onMapClick = (e: L.LeafletMouseEvent) => {
      if (Date.now() - lastDragEnd < 400) return;
      const next: LatLngTuple = [
        Number(e.latlng.lat.toFixed(6)),
        Number(e.latlng.lng.toFixed(6)),
      ];
      marker.setLatLng(next);
      lastEmittedRef.current = `${next[0]},${next[1]}`;
      setReadOut(next);
      onPinChangeRef.current(next[0], next[1]);
    };
    map.on("click", onMapClick);

    // Emit the initial position once.
    lastEmittedRef.current = `${start[0]},${start[1]}`;
    onPinChangeRef.current(start[0], start[1]);

    // Cleanup.
    return () => {
      const ie = iconEl as any;
      if (ie && typeof ie.__draepPointerDown === "function") {
        ie.removeEventListener("pointerdown", ie.__draepPointerDown);
        ie.__draepPointerDown = null;
      }
      marker.off();
      map.off();
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── External "fly to" command (e.g. from pincode geocode) ──────────────
  // Watches only the nonce, so the parent updating `pin` state in response
  // to our `onPinChange` (which doesn't bump the nonce) won't loop.
  const lastFlyNonceRef = useRef<number>(0);
  useEffect(() => {
    if (!flyTo) return;
    if (flyTo.nonce === lastFlyNonceRef.current) return;
    lastFlyNonceRef.current = flyTo.nonce;

    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker) return;

    const next: LatLngTuple = [
      Number(flyTo.lat.toFixed(6)),
      Number(flyTo.lng.toFixed(6)),
    ];
    marker.setLatLng(next);
    // Animate the map to the new location at a useful street-level zoom.
    map.flyTo(next, Math.max(map.getZoom(), 15), { duration: 0.8 });

    lastEmittedRef.current = `${next[0]},${next[1]}`;
    setReadOut(next);
    onPinChangeRef.current(next[0], next[1]);
  }, [flyTo]);

  // ─── Use my location ──────────────────────────────────────────────────────
  const useMyLocation = () => {
    // Stray-click guard: if we just finished dragging the marker, the browser
    // dispatches a synthetic click that can land on this button. Ignore it.
    if (Date.now() < suppressClickUntilRef.current) {
      suppressClickUntilRef.current = 0;
      return;
    }
    setGeoError(null);
    setGeoInfo(null);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeoError("Geolocation isn't supported on this device.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const next: LatLngTuple = [
          Number(pos.coords.latitude.toFixed(6)),
          Number(pos.coords.longitude.toFixed(6)),
        ];
        // Imperative — React never sees this position as a prop.
        markerRef.current?.setLatLng(next);
        mapRef.current?.setView(next, mapRef.current.getZoom(), { animate: true });
        lastEmittedRef.current = `${next[0]},${next[1]}`;
        setReadOut(next);
        onPinChangeRef.current(next[0], next[1]);
        setLocating(false);
      },
      (err) => {
        setLocating(false);
        if (err.code === err.PERMISSION_DENIED) {
          setGeoInfo("No worries — drag the pin to your address instead.");
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          setGeoError("Couldn't determine your location. Drag the pin instead.");
        } else if (err.code === err.TIMEOUT) {
          setGeoError("Location request timed out. Try again or drag the pin.");
        } else {
          setGeoError("Couldn't get your location. Drag the pin instead.");
        }
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
    );
  };

  return (
    <div>
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-card border border-hairline-strong">
        {/* Leaflet mounts inside this div. React never touches the children. */}
        <div ref={containerRef} className="h-full w-full" style={{ background: "#083068" }} />

        <button
          type="button"
          onClick={useMyLocation}
          disabled={locating}
          className="absolute bottom-2 right-2 z-[1000] inline-flex items-center gap-1 rounded-pill bg-chalk-white px-3 py-1.5 text-caption font-medium text-ink-navy shadow-card disabled:opacity-60"
        >
          <Crosshair size={14} />
          {locating ? "Locating…" : strings.contact.useMyLocation}
        </button>
      </div>

      <div className="mt-2 flex items-center gap-2 text-caption text-muted">
        <MapPin size={14} />
        {readOut
          ? `${readOut[0].toFixed(4)}, ${readOut[1].toFixed(4)}`
          : "Tap ‘Use my location’ or drag the pin."}
      </div>

      {geoInfo && (
        <p className="mt-1 text-caption text-muted">{geoInfo}</p>
      )}

      {geoError && (
        <p className="mt-1 text-caption text-error-text">{geoError}</p>
      )}
    </div>
  );
}
