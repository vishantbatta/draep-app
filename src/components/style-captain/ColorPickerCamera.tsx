"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * ColorPickerCamera — full-screen color capture overlay.
 *
 * Two phases:
 *
 * Phase 1 — CAPTURE (split-screen 50/50):
 *   ┌──────────────────────┐
 *   │                      │
 *   │   LIVE CAMERA        │  ← top half, with a + marker dead center
 *   │        ✛             │
 *   ├──────────────────────┤
 *   │                      │
 *   │   SAMPLED COLOR      │  ← bottom half, solid fill of center pixel
 *   │   #RRGGBB            │
 *   │                      │
 *   └──────────────────────┘
 *
 * Phase 2 — CONFIRM (full screen):
 *   The captured color fills the entire screen so the captain can hold
 *   the phone next to the cloth to visually verify the match, then tap
 *   "Mark as done" to confirm.
 */
export function ColorPickerCamera({
  onPick,
  onClose,
}: {
  onPick: (hex: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  const [hex, setHex] = useState("#888888");
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [captured, setCaptured] = useState<string | null>(null);

  // Sample the center pixel of the video frame and update the swatch.
  const sampleCenter = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.videoWidth === 0) {
      rafRef.current = requestAnimationFrame(sampleCenter);
      return;
    }

    // Keep canvas tiny — we only need 1 pixel but draw a small region
    // for stability (average of a 5×5 patch around the center).
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      rafRef.current = requestAnimationFrame(sampleCenter);
      return;
    }

    const w = video.videoWidth;
    const h = video.videoHeight;
    canvas.width = 5;
    canvas.height = 5;
    ctx.drawImage(video, w / 2 - 2, h / 2 - 2, 5, 5, 0, 0, 5, 5);
    const { data } = ctx.getImageData(0, 0, 5, 5);

    // Average the 25 pixels for noise reduction
    let r = 0,
      g = 0,
      b = 0;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
    }
    r = Math.round(r / 25);
    g = Math.round(g / 25);
    b = Math.round(b / 25);

    const nextHex =
      "#" +
      [r, g, b]
        .map((v) => v.toString(16).padStart(2, "0"))
        .join("")
        .toUpperCase();
    setHex(nextHex);

    rafRef.current = requestAnimationFrame(sampleCenter);
  }, []);

  // Boot the camera whenever we (re-)enter capture mode (captured === null).
  // The cleanup runs when captured is set OR component unmounts, stopping the
  // stream + RAF so the next time captured returns to null, the camera boots
  // fresh.
  useEffect(() => {
    if (captured !== null) return; // Only boot when in capture phase
    let cancelled = false;

    // Reset state from any previous capture cycle
    setReady(false);
    setError(null);

    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setError("Camera API not supported on this device.");
          return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => {});
          setReady(true);
          rafRef.current = requestAnimationFrame(sampleCenter);
        }
      } catch (err) {
        const msg =
          err instanceof DOMException && err.name === "NotAllowedError"
            ? "Camera permission denied. Please allow camera access."
            : err instanceof Error
              ? err.message
              : "Failed to open camera.";
        setError(msg);
      }
    }

    void start();
    return () => {
      cancelled = true;
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      const s = streamRef.current;
      if (s) {
        s.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [captured, sampleCenter]);

  // ─── Phase 2: CONFIRM — full screen captured color ───
  if (captured) {
    const light = isLight(captured);
    return (
      <div
        className="fixed inset-0 z-50 flex flex-col items-center justify-between px-6 py-[max(2rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))]"
        style={{ backgroundColor: captured }}
      >
        {/* Top: close button */}
        <div className="flex w-full justify-start">
          <button
            onClick={onClose}
            className="tap rounded-pill px-3 py-1.5 text-caption font-medium backdrop-blur"
            style={{
              backgroundColor: light ? "rgba(26,26,46,0.25)" : "rgba(255,255,255,0.2)",
              color: light ? "#1a1a2e" : "#ffffff",
            }}
          >
            ✕ Cancel
          </button>
        </div>

        {/* Center: instruction */}
        <div className="flex flex-col items-center gap-3 text-center">
          <p
            className="text-h3 font-bold leading-snug"
            style={{ color: light ? "#1a1a2e" : "#ffffff" }}
          >
            Hold your phone next to the cloth to match the color.
          </p>
          <p
            className="font-mono text-h4 font-bold tracking-wider"
            style={{ color: light ? "#1a1a2e" : "#ffffff" }}
          >
            {captured}
          </p>
        </div>

        {/* Bottom: actions */}
        <div className="flex w-full max-w-sm flex-col gap-3">
          <button
            onClick={() => setCaptured(null)}
            className="tap w-full rounded-pill px-6 py-3 text-body font-semibold backdrop-blur"
            style={{
              backgroundColor: light ? "rgba(26,26,46,0.2)" : "rgba(255,255,255,0.18)",
              color: light ? "#1a1a2e" : "#ffffff",
            }}
          >
            Retake
          </button>
          <button
            onClick={() => onPick(captured)}
            className="tap w-full rounded-pill bg-ink-navy px-6 py-3 text-body font-semibold text-chalk-white shadow-lg"
          >
            Mark as done
          </button>
        </div>
      </div>
    );
  }

  // ─── Phase 1: CAPTURE — 50/50 split screen ───
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-ink-navy">
      {/* Hidden sampling canvas */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Top half — camera preview with center crosshair */}
      <div className="relative h-1/2 w-full overflow-hidden bg-ink-navy">
        <video
          ref={videoRef}
          playsInline
          muted
          className="h-full w-full object-cover"
        />
        {/* Crosshair */}
        {ready && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="relative h-16 w-16">
              {/* circle */}
              <div className="absolute inset-0 rounded-full border-2 border-chalk-white/80" />
              {/* horizontal line */}
              <div className="absolute left-1/2 top-1/2 h-px w-10 -translate-x-1/2 -translate-y-1/2 bg-chalk-white/80" />
              {/* vertical line */}
              <div className="absolute left-1/2 top-1/2 h-10 w-px -translate-x-1/2 -translate-y-1/2 bg-chalk-white/80" />
              {/* center dot */}
              <div className="absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-error-text" />
            </div>
          </div>
        )}

        {/* Top bar: close button */}
        <div className="absolute left-0 right-0 top-0 flex items-center justify-between px-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <button
            onClick={onClose}
            className="tap rounded-pill bg-ink-navy/60 px-3 py-1.5 text-caption font-medium text-chalk-white backdrop-blur"
          >
            ✕ Cancel
          </button>
          <span className="rounded-pill bg-ink-navy/60 px-3 py-1.5 text-caption font-medium text-chalk-white backdrop-blur">
            Align crosshair on cloth
          </span>
        </div>

        {error && (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div className="max-w-sm rounded-card border border-error-border bg-chalk-white px-4 py-3 text-center text-caption text-error-text">
              {error}
            </div>
          </div>
        )}
      </div>

      {/* Bottom half — live color swatch + select button */}
      <div
        className="flex h-1/2 w-full flex-col items-center justify-center gap-3 px-6 py-[max(1rem,env(safe-area-inset-bottom))]"
        style={{ backgroundColor: hex }}
      >
        <p
          className="font-mono text-h4 font-bold tracking-wider"
          style={{
            color: isLight(hex) ? "#1a1a2e" : "#ffffff",
          }}
        >
          {hex}
        </p>
        <button
          onClick={() => setCaptured(hex)}
          disabled={!ready || !!error}
          className="tap w-full max-w-xs rounded-pill bg-ink-navy px-6 py-3 text-body font-semibold text-chalk-white shadow-lg disabled:opacity-50"
        >
          Select this color
        </button>
      </div>
    </div>
  );
}

/** Determine if a hex color is "light" so we can pick contrasting text. */
function isLight(hex: string): boolean {
  const m = hex.replace("#", "");
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  // Relative luminance (sRGB) → perceived brightness
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.55;
}
