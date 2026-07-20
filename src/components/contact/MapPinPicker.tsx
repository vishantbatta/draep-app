"use client";

/**
 * MapPinPicker — mocked V0 (spec §6.10).
 *
 * Uses the browser geolocation API + a static SVG map. Real Google Maps SDK
 * drops in behind this component without touching call sites.
 *
 * On pin set: reverse-geocode placeholder returns "Approximate location" until
 * the real SDK is wired up.
 */

import { useEffect, useState } from "react";

import { Crosshair, MapPin } from "@/components/ui/icons";
import { checkServiceArea } from "@/lib/service-area";
import { strings } from "@/lib/strings";
import type { ServiceAreaResult } from "@/lib/service-area";

interface MapPinPickerProps {
  lat?: number;
  lng?: number;
  onPinChange: (lat: number, lng: number) => void;
}

export function MapPinPicker({ lat, lng, onPinChange }: MapPinPickerProps) {
  const [locating, setLocating] = useState(false);
  const [area, setArea] = useState<ServiceAreaResult | null>(null);

  useEffect(() => {
    if (lat != null && lng != null) {
      setArea(checkServiceArea(lat, lng));
    }
  }, [lat, lng]);

  const useMyLocation = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onPinChange(pos.coords.latitude, pos.coords.longitude);
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  // Map preview is a placeholder — the real Google Maps SDK draws into this box.
  // Pin is shown relative to a Bangalore-centered grid (Harlur area).
  return (
    <div>
      <div
        className="relative aspect-[4/3] w-full overflow-hidden rounded-card border border-hairline-strong bg-mist-navy"
        role="img"
        aria-label={
          lat != null && lng != null
            ? `Location set to ${lat.toFixed(4)}, ${lng.toFixed(4)}`
            : "Drag the pin to your address"
        }
      >
        {/* Static grid — Bangalore-like */}
        <svg viewBox="0 0 240 180" className="h-full w-full">
          <defs>
            <pattern id="map-grid" width="20" height="20" patternUnits="userSpaceOnUse">
              <path d="M 20 0 L 0 0 0 20" fill="none" stroke="var(--tape-silver)" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="240" height="180" fill="var(--navy-bg)" />
          <rect width="240" height="180" fill="url(#map-grid)" />
          {/* Fake roads */}
          <path d="M0 90 Q60 80, 120 95 T240 100" stroke="var(--tape-silver)" strokeWidth="3" fill="none" opacity="0.6" />
          <path d="M120 0 L130 180" stroke="var(--tape-silver)" strokeWidth="3" fill="none" opacity="0.6" />
          {/* Service area hint */}
          <circle cx="120" cy="90" r="40" fill="var(--orange-fill)" opacity="0.4" />
          <circle cx="120" cy="90" r="40" stroke="var(--draep-orange)" strokeWidth="1" fill="none" strokeDasharray="4 4" />
        </svg>

        {/* Pin */}
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-full text-accent-text"
          aria-hidden
        >
          <MapPin size={36} strokeWidth={2.5} />
        </div>

        <button
          type="button"
          onClick={useMyLocation}
          disabled={locating}
          className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-pill bg-chalk-white px-3 py-1.5 text-caption font-medium text-ink-navy shadow-card disabled:opacity-60"
        >
          <Crosshair size={14} />
          {locating ? "Locating…" : strings.contact.useMyLocation}
        </button>
      </div>

      <div className="mt-2 flex items-center gap-2 text-caption text-muted">
        <MapPin size={14} />
        {lat != null && lng != null
          ? `${lat.toFixed(4)}, ${lng.toFixed(4)}`
          : "Tap ‘Use my location’ or drag the pin."}
      </div>

      {area && !area.serviceable && (
        <p className="mt-1 text-caption text-error-text">
          Outside V0 service area.
        </p>
      )}
      {area?.serviceable && (
        <p className="mt-1 text-caption text-success-text">
          In our {area.areaName} service area.
        </p>
      )}
    </div>
  );
}
