"use client";

import { memo, useEffect, useRef, useState } from "react";

/**
 * VoiceNoteRecorder — single-step voice note capture.
 *
 * Flow:
 *   idle      → "Record voice note" button
 *   recording → red stop button + timer
 *   saving    → spinner while auto-uploading (shown briefly after stop)
 *   saved     → green checkmark + audio player + "Re-record" link
 *
 * When the user stops recording the blob is uploaded immediately — no
 * intermediate "preview + save" step. Re-recording uploads a new file
 * and replaces the URL via `onUploaded`.
 *
 * Wrapped in React.memo so parent re-renders never tear down an
 * in-progress recording.  MediaRecorder uses a 1 s timeslice to keep
 * memory low on mobile browsers.
 */
export const VoiceNoteRecorder = memo(function VoiceNoteRecorder({
  jobId,
  onUploaded,
  uploadedUrl,
}: {
  jobId: string;
  onUploaded: (url: string | null) => void;
  uploadedUrl?: string | null;
}) {
  const [state, setState] = useState<
    "idle" | "recording" | "saving" | "saved"
  >(uploadedUrl ? "saved" : "idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [assetUrl, setAssetUrl] = useState<string | null>(uploadedUrl ?? null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onUploadedRef = useRef(onUploaded);

  useEffect(() => {
    onUploadedRef.current = onUploaded;
  }, [onUploaded]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      const s = streamRef.current;
      if (s) s.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function startRecording() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = pickMimeType();
      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = mr;
      chunksRef.current = [];

      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mr.onstop = () => {
        // Stop the mic stream immediately
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;

        const blob = new Blob(chunksRef.current, {
          type: mr.mimeType || "audio/webm",
        });
        if (blob.size === 0) {
          setError("Recording is empty.");
          setState("idle");
          return;
        }
        // Auto-upload immediately — no intermediate preview step
        void uploadBlob(blob);
      };

      mr.onerror = () => {
        setError("Recording error. Please try again.");
        setState("idle");
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
      };

      mr.start(1000);
      setState("recording");
      setSeconds(0);
      timerRef.current = setInterval(() => {
        setSeconds((s) => s + 1);
      }, 1000);
    } catch (err) {
      const msg =
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Microphone permission denied."
          : err instanceof Error
            ? err.message
            : "Failed to access microphone.";
      setError(msg);
    }
  }

  function stopRecording() {
    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== "inactive") {
      mr.stop();
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  async function uploadBlob(blob: Blob) {
    setState("saving");
    setError(null);
    try {
      const { scUploadVoiceNote } = await import("@/lib/style-captain-api");
      const result = await scUploadVoiceNote(jobId, blob);
      setAssetUrl(result.url);
      onUploadedRef.current(result.url);
      setState("saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setState("idle");
    }
  }

  function handleRerecord() {
    setAssetUrl(null);
    onUploadedRef.current(null);
    setError(null);
    setSeconds(0);
    setState("idle");
    // Immediately start a fresh recording
    void startRecording();
  }

  function fmtTime(s: number): string {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  }

  // ─── Saved state ───
  if (state === "saved" && assetUrl) {
    return (
      <div className="rounded-card border border-success-border bg-success-bg/50 p-3">
        <div className="flex items-center gap-2">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4 shrink-0 text-success-text"
            aria-hidden="true"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span className="text-caption font-medium text-success-text">
            Voice note saved
          </span>
          <button
            onClick={handleRerecord}
            className="tap ml-auto flex items-center gap-1 text-[11px] font-medium text-muted underline"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-3.5 w-3.5"
              aria-hidden="true"
            >
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
            Re-record
          </button>
        </div>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <audio
          controls
          src={resolveUrl(assetUrl)}
          className="mt-2 h-9 w-full"
        />
      </div>
    );
  }

  // ─── Saving (briefly visible while uploading) ───
  if (state === "saving") {
    return (
      <div className="flex items-center justify-center gap-2 rounded-card border border-hairline bg-chalk-white p-4">
        <svg
          className="h-4 w-4 animate-spin text-accent-text"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
        <span className="text-caption font-medium text-muted">Saving voice note…</span>
      </div>
    );
  }

  // ─── Recording state ───
  if (state === "recording") {
    return (
      <div className="rounded-card border border-error-border bg-error-bg/30 p-3">
        {error && (
          <p className="mb-2 text-[11px] text-error-text">{error}</p>
        )}
        <div className="flex items-center gap-3">
          <button
            onClick={stopRecording}
            className="tap flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-error-text shadow-lg"
            aria-label="Stop recording"
          >
            <span className="h-4 w-4 rounded-sm bg-chalk-white" />
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-error-text" />
            <span className="font-mono text-body font-semibold text-ink-navy">
              {fmtTime(seconds)}
            </span>
            <span className="text-caption text-muted">Recording… tap to stop</span>
          </div>
        </div>
      </div>
    );
  }

  // ─── Idle state ───
  return (
    <div>
      {error && (
        <p className="mb-2 text-[11px] text-error-text">{error}</p>
      )}
      <button
        onClick={startRecording}
        className="tap flex w-full items-center justify-center gap-2 rounded-pill border border-dashed border-accent-text/40 bg-warm-sand px-4 py-3 text-body font-medium text-accent-text"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-5 w-5"
          aria-hidden="true"
        >
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="23" />
          <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
        {uploadedUrl ? "Record again" : "Record voice note"}
      </button>
    </div>
  );
});

const BE_ORIGIN = (
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1"
).replace(/\/api\/v\d+$/, "");

function resolveUrl(url: string): string {
  return url.startsWith("http") ? url : `${BE_ORIGIN}${url}`;
}

/**
 * Pick the first MediaRecorder mime type the current browser supports.
 * Chrome → audio/webm;opus, Safari → audio/mp4, fallback → default.
 */
function pickMimeType(): string | null {
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported)
    return null;
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
    "audio/aac",
  ];
  for (const c of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return null;
}
