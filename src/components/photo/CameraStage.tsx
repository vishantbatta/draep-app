"use client";

/**
 * CameraStage — an in-sheet getUserMedia viewfinder with a shutter.
 *
 * Opens the camera directly (no OS file modal) on desktop webcams and mobile
 * cameras alike. Shared by the try-on sheet (front camera, mirrored selfie
 * preview) and the auto-design photo picker (rear camera, photographing a
 * garment — not mirrored, so text and asymmetric details read correctly).
 * The shutter grabs exactly what the preview shows. When the camera can't
 * be opened (permission denied, no device, insecure context) the stage
 * offers a retry plus the caller's upload input as a fallback.
 */

import { motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";

import { strings } from "@/lib/strings";

export function CameraStage({
  onCapture,
  onCancel,
  onFallbackUpload,
  facing = "user",
  filePrefix = "capture",
}: {
  onCapture: (file: File) => void;
  onCancel: () => void;
  onFallbackUpload: () => void;
  /** "user" = front camera, preview + capture mirrored (selfie feel);
   *  "environment" = rear camera, nothing mirrored. */
  facing?: "user" | "environment";
  /** Captured file is named `<prefix>-<timestamp>.jpg`. */
  filePrefix?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<
    "starting" | "live" | "denied" | "unsupported"
  >("starting");
  const mirrored = facing === "user";

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const start = useCallback(async () => {
    stopStream();
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("unsupported");
      return;
    }
    setStatus("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setStatus("live");
    } catch {
      stopStream();
      setStatus("denied");
    }
  }, [stopStream, facing]);

  useEffect(() => {
    void start();
    return stopStream;
  }, [start, stopStream]);

  const shoot = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (mirrored) {
      // Mirror the grab to match the flipped preview (WYSIWYG).
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        onCapture(
          new File([blob], `${filePrefix}-${Date.now()}.jpg`, { type: "image/jpeg" }),
        );
      },
      "image/jpeg",
      0.92,
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      className="flex flex-col gap-2.5 pb-1"
    >
      <div
        className="relative w-full overflow-hidden rounded-card bg-ink-navy"
        style={{ aspectRatio: "3 / 4", maxHeight: "min(48dvh, 420px)" }}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="pointer-events-none h-full w-full object-cover"
          style={mirrored ? { transform: "scaleX(-1)" } : undefined}
        />

        {status !== "live" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
            {status === "starting" ? (
              <span
                aria-hidden
                className="h-8 w-8 animate-spin rounded-full border-2 border-chalk-white/30 border-t-chalk-white"
              />
            ) : (
              <>
                <CameraGlyph />
                <p className="text-caption text-chalk-white">
                  {status === "denied"
                    ? strings.tryOn.cameraDenied
                    : strings.tryOn.cameraUnsupported}
                </p>
                {status === "denied" && (
                  <button
                    type="button"
                    onClick={() => void start()}
                    className="rounded-pill px-4 py-2 text-caption font-semibold text-chalk-white shadow-primary transition-all active:scale-[0.98]"
                    style={{ backgroundImage: "var(--tape-gradient)" }}
                  >
                    {strings.tryOn.cameraRetry}
                  </button>
                )}
                <button
                  type="button"
                  onClick={onFallbackUpload}
                  className="rounded-pill border border-chalk-white/40 px-4 py-2 text-caption font-semibold text-chalk-white transition-colors hover:bg-chalk-white/10"
                >
                  {strings.tryOn.cameraUseUpload}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {status === "live" && (
        <div className="flex items-center justify-center py-1">
          <button
            type="button"
            onClick={shoot}
            aria-label={strings.tryOn.shutterLabel}
            className="flex h-16 w-16 items-center justify-center rounded-full border-[3px] border-ink-navy bg-chalk-white p-1.5 shadow-primary transition-transform active:scale-95"
          >
            <span
              aria-hidden
              className="h-full w-full rounded-full"
              style={{ backgroundImage: "var(--tape-gradient)" }}
            />
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={onCancel}
        className="self-center rounded-pill px-4 py-1.5 text-caption font-semibold text-muted transition-colors hover:text-ink-navy"
      >
        {strings.tryOn.cameraCancel}
      </button>
    </motion.div>
  );
}

export function CameraGlyph({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-accent-text"
      aria-hidden
    >
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}
