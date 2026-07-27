"use client";

/**
 * MapPinPicker — public wrapper.
 *
 * Dynamically loads the real Leaflet-backed picker with `ssr: false` so
 * Leaflet (which touches `window` at import time) never runs on the server.
 *
 * Falls back to a small skeleton while the chunk loads.
 *
 * The contact page doesn't need to change — same props as before.
 */

import dynamic from "next/dynamic";

const LeafletMapPicker = dynamic(
  () =>
    import("./LeafletMapPicker").then((m) => ({
      default: m.LeafletMapPicker,
    })),
  {
    ssr: false,
    loading: () => (
      <div>
        <div className="relative aspect-[4/3] w-full animate-pulse overflow-hidden rounded-card border border-hairline-strong bg-mist-navy" />
        <div className="mt-2 h-3 w-40 animate-pulse rounded-pill bg-mist-navy" />
      </div>
    ),
  },
);

export interface MapPinPickerProps {
  lat?: number;
  lng?: number;
  onPinChange: (lat: number, lng: number) => void;
  flyTo?: { lat: number; lng: number; nonce: number };
}

export function MapPinPicker({ lat, lng, onPinChange, flyTo }: MapPinPickerProps) {
  return <LeafletMapPicker lat={lat} lng={lng} onPinChange={onPinChange} flyTo={flyTo} />;
}
