"use client";

import { memo, useEffect, useRef, useState } from "react";

/**
 * VoicePlayer — minimal custom play/pause player for a recorded voice note.
 *
 * The backend transcodes every voice note to MP3 at upload time, so the
 * served file is universally decodable by a native <audio> element. We drive
 * a hidden <audio> from a single custom Play/Pause button (no seek bar, per
 * the spec). This replaces the earlier Web-Audio decode path, which was a
 * workaround for Opus-in-WebM sources that Chrome's media element rejected
 * (MEDIA_ERR_SRC_NOT_SUPPORTED). With MP3 sources that workaround is no
 * longer needed and native playback is far more reliable.
 */
export const VoicePlayer = memo(function VoicePlayer({
  src,
}: {
  src: string;
}) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [errLabel, setErrLabel] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Create the audio element once.
  useEffect(() => {
    const audio = new Audio();
    audio.preload = "auto";
    audioRef.current = audio;

    const onCanPlay = () => setStatus("ready");
    const onPlaying = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTimeUpdate = () =>
      setElapsed(audio.currentTime || 0);
    const onEnded = () => {
      setPlaying(false);
      setElapsed(0);
      // Snap back to the start so the next Play begins from 0:00.
      try {
        audio.currentTime = 0;
      } catch {
        /* ignore */
      }
    };
    const onError = () => {
      console.warn("[VoicePlayer] audio error:", audio.error);
      setErrLabel("Can’t play this recording");
      setStatus("error");
    };

    audio.addEventListener("canplay", onCanPlay);
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);

    // Load the source.
    setStatus("loading");
    setErrLabel(null);
    setPlaying(false);
    setElapsed(0);
    audio.src = src;
    audio.load();

    return () => {
      audio.removeEventListener("canplay", onCanPlay);
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audio.pause();
      audio.src = "";
      audioRef.current = null;
    };
  }, [src]);

  function toggle() {
    const audio = audioRef.current;
    if (!audio || status === "error") return;
    if (playing) {
      audio.pause();
    } else {
      // play() returns a promise; swallow the autoplay rejection if any.
      audio.play().catch((err) => {
        console.warn("[VoicePlayer] play() rejected:", err);
      });
    }
  }

  function fmt(s: number): string {
    if (!Number.isFinite(s) || s < 0) s = 0;
    const total = Math.floor(s);
    const m = Math.floor(total / 60);
    const sec = total % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  }

  const showSpinner = status === "loading";

  return (
    <div className="mt-2 flex items-center gap-3">
      <button
        type="button"
        onClick={toggle}
        disabled={status === "loading"}
        aria-label={playing ? "Pause voice note" : "Play voice note"}
        className="tap flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-text text-chalk-white shadow-sm disabled:opacity-50"
      >
        {showSpinner ? (
          <svg
            className="h-4 w-4 animate-spin"
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
        ) : playing ? (
          <svg
            viewBox="0 0 24 24"
            fill="currentColor"
            className="h-4 w-4"
            aria-hidden="true"
          >
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        ) : (
          <svg
            viewBox="0 0 24 24"
            fill="currentColor"
            className="h-4 w-4"
            aria-hidden="true"
          >
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>

      <span className="font-mono text-caption text-muted">
        {status === "error"
          ? errLabel ?? "Can’t play"
          : showSpinner
            ? "Loading…"
            : fmt(elapsed)}
      </span>
    </div>
  );
});
