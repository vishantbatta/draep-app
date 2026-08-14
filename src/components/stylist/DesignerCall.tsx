"use client";

/**
 * DesignerCall — full-screen video call with the AI fashion designer.
 *
 * Visual language follows the Draep Brand Book:
 *   - Ink Navy (#083068) call canvas, Warm Sand (#FFF6EA) pre-call surface.
 *   - Draep Orange tape gradient as the single accent — on the CTA, active
 *     control states, and the agent wavebeat. Navy + orange on every screen
 *     (Brand Book §04, "never one without the other").
 *   - Poppins headings, Inter body, IBM Plex Mono for the timer (§05).
 *   - 12px cards, pill controls, tick dividers, rivet dots (§06).
 *
 *   PRE-CALL  — calling card on warm sand: Draep symbol avatar, name, copy,
 *               tape-gradient "Start video call" CTA.
 *
 *   IN-CALL  — ink-navy canvas:
 *     top    : back · name · status / Plex Mono timer
 *     center : full-bleed self-view video (mirrored); Draep symbol when cam off
 *     float  : AgentWavebeat — Draep alpha at center, concentric pulsing tape
 *              rings + a radial amplitude ring ("agent speaking from the
 *              other side")
 *     bottom : round controls (mute · video) + red end-call
 *
 * No speaker control, no end-to-end-encrypted label — per spec.
 */

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

import { DraepSymbol } from "@/components/brand/DraepSymbol";
import { ArrowLeft } from "@/components/ui/icons";
import { strings } from "@/lib/strings";
import type { CallStatus, CloseDetail, DesignImage } from "@/hooks/useGeminiLiveCall";

interface Props {
  status: CallStatus;
  designImages: DesignImage[];
  /** Designs currently being rendered server-side — shows the sketching card. */
  designPendingCount: number;
  designError: string | null;
  errorMsg: string | null;
  closeDetail: CloseDetail | null;
  muted: boolean;
  videoOn: boolean;
  /** Absolute time the call first went live (survives reconnects). */
  callStartedAt: number | null;
  videoRef: React.RefObject<HTMLVideoElement>;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  onConnect: () => void;
  onDisconnect: () => void;
  onToggleMute: () => void;
  onToggleVideo: () => void;
  onBack: () => void;
  getSpeakingAmplitude: () => number;
}

export function DesignerCall({
  status,
  designImages,
  designPendingCount,
  designError,
  errorMsg,
  closeDetail,
  muted,
  videoOn,
  callStartedAt,
  videoRef,
  canvasRef,
  onConnect,
  onDisconnect,
  onToggleMute,
  onToggleVideo,
  onBack,
  getSpeakingAmplitude,
}: Props) {
  // Back-arrow confirmation — one accidental tap shouldn't kill a live call.
  const [confirmExit, setConfirmExit] = useState(false);

  if (status === "idle" || status === "error") {
    return (
      <PreCallScreen hasError={status === "error"} errorMsg={errorMsg} onStart={onConnect} onBack={onBack} />
    );
  }

  const isConnected = status === "connected";
  const isRinging = status === "ringing";
  const isReconnecting = status === "reconnecting";
  const showCallError =
    (status === "connecting" || status === "connected" || isReconnecting || isRinging) && !!errorMsg;

  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-ink-navy">
      <canvas ref={canvasRef} className="hidden" />

      {/* ─── Full-screen self-view video (mirrored) ─── */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="absolute inset-0 h-full w-full object-cover"
        style={{ transform: "scaleX(-1)" }}
      />

      {/* Navy scrims top + bottom for legibility (keeps the brand canvas underneath) */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(8,48,104,0.55) 0%, rgba(8,48,104,0.0) 22%, rgba(8,48,104,0.0) 58%, rgba(8,48,104,0.72) 100%)",
        }}
      />

      {/* ─── Camera off → navy placeholder + Draep alpha mark ─── */}
      <AnimatePresence>
        {!videoOn && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-[1] flex items-center justify-center bg-ink-navy"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo_alpha_icon.png"
              alt="draep"
              className="h-24 w-24 rounded-card object-cover opacity-90"
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Top header: back + caller identity ─── */}
      <div className="relative z-10 flex items-start gap-3 px-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={() => setConfirmExit(true)}
          aria-label={strings.stylist.back}
          className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-pill bg-white/12 text-chalk-white transition-colors hover:bg-white/20"
        >
          <ArrowLeft size={20} />
        </button>

        <CallHeader
          isConnected={isConnected}
          isRinging={isRinging}
          isReconnecting={isReconnecting}
          isConnecting={status === "connecting"}
          startedAt={callStartedAt}
        />

        {/* balance spacer for the centered header */}
        <div className="w-10 shrink-0" />
      </div>

      {/* ─── Reconnecting banner ─── */}
      <AnimatePresence>
        {isReconnecting && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.25 }}
            className="relative z-10 mx-auto mt-3 flex w-full max-w-[calc(100%-2.5rem)] items-center justify-center gap-2 rounded-pill px-4 py-2"
            style={{ background: "rgba(255,255,255,0.10)" }}
          >
            <motion.span
              aria-hidden
              className="h-2 w-2 rounded-full bg-draep-orange"
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
            />
            <span className="text-caption font-medium text-chalk-white/90">
              Connection dipped — reconnecting
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Sketching card — design rendering in progress ─── */}
      <AnimatePresence>
        {designPendingCount > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="relative z-10 mx-auto mt-4 w-full max-w-[calc(100%-2rem)]"
          >
            <SketchingCard count={designPendingCount} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Design preview sheet ─── */}
      <AnimatePresence>
        {designImages.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 48, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 48 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="relative z-10 mx-auto mt-4 w-full max-w-[calc(100%-2rem)]"
          >
            <DesignGallery designs={designImages} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Design generation error toast ─── */}
      <AnimatePresence>
        {designError && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="relative z-10 mx-auto mt-3 w-full max-w-[calc(100%-2rem)]"
          >
            <div
              className="flex items-center gap-2 rounded-card px-3.5 py-2.5"
              style={{ background: "rgba(220,38,38,0.30)" }}
            >
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="shrink-0 text-red-200" aria-hidden>
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span className="text-caption text-red-50">{designError}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Floating agent wavebeat — Draep alpha + circular wave ─── */}
      <AgentWavebeat
        isRinging={isRinging}
        isConnected={isConnected}
        isReconnecting={isReconnecting}
        getSpeakingAmplitude={getSpeakingAmplitude}
      />

      <div className="flex-1" />

      {/* ─── Bottom control dock ─── */}
      <div className="relative z-10 px-6 pb-[max(1.75rem,env(safe-area-inset-bottom))] pt-3">
        <ControlDock
          muted={muted}
          videoOn={videoOn}
          onToggleMute={onToggleMute}
          onToggleVideo={onToggleVideo}
          onEnd={onDisconnect}
        />
      </div>

      <AnimatePresence>
        {showCallError && (
          <ErrorModal errorMsg={errorMsg} closeDetail={closeDetail} onBack={onBack} onRetry={onConnect} />
        )}
      </AnimatePresence>

      {/* ─── Back-arrow confirmation — don't lose a live call to a stray tap ─── */}
      <AnimatePresence>
        {confirmExit && (
          <ConfirmExitSheet onConfirm={onBack} onCancel={() => setConfirmExit(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}

/* ============================================================ */
/*  Call header — name, status dot, Plex Mono timer             */
/* ============================================================ */

function CallHeader({
  isConnected,
  isRinging,
  isReconnecting,
  isConnecting,
  startedAt,
}: {
  isConnected: boolean;
  isRinging: boolean;
  isReconnecting: boolean;
  isConnecting: boolean;
  startedAt: number | null;
}) {
  // Timer ticks from the absolute start time, so a reconnect doesn't reset
  // the displayed duration to 00:00 — it's one call, not several.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  const seconds = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;
  const mm = String(Math.floor(seconds / 60)).padStart(1, "0");
  const ss = String(seconds % 60).padStart(2, "0");

  // Once the call is connected we show only the timer — no "Connected" /
  // "Speaking" label (the wavebeat already conveys live state visually).
  // While ringing / connecting / reconnecting we show that status text.
  const statusText = isConnecting
    ? strings.stylist.connecting
    : isRinging
      ? strings.stylist.ringing
      : isReconnecting
        ? "Reconnecting…"
        : "";

  return (
    <div className="flex flex-1 flex-col items-center">
      <span className="mt-1 flex items-center gap-1.5 text-caption leading-tight text-chalk-white/80">
        <span
          aria-hidden
          className="h-1.5 w-1.5 rounded-full"
          style={{
            background: isRinging || isReconnecting
              ? "var(--draep-orange)"
              : isConnected
                ? "var(--success)"
                : "rgba(255,255,255,0.5)",
          }}
        />
        {isConnected && !isReconnecting ? (
          <span className="font-mono tabular-nums">{mm}:{ss}</span>
        ) : (
          <span>{statusText}</span>
        )}
      </span>
    </div>
  );
}

/* ============================================================ */
/*  AgentWavebeat — Draep alpha at center with a circular       */
/*  wavebeat: concentric pulsing tape rings + a radial amplitude */
/*  ring. The visual impression is the Draep mark breathing as   */
/*  the agent speaks "from the other side".                      */
/* ============================================================ */

function AgentWavebeat({
  isRinging,
  isConnected,
  isReconnecting,
  getSpeakingAmplitude,
}: {
  isRinging: boolean;
  isConnected: boolean;
  isReconnecting: boolean;
  getSpeakingAmplitude: () => number;
}) {
  const show = isRinging || isConnected || isReconnecting;
  const [amp, setAmp] = useState(0);
  const rafRef = useRef<number | null>(null);
  const tRef = useRef(0);

  useEffect(() => {
    if (!show) return;
    // Sample the analyser at ~15fps instead of every rAF frame — React
    // state updates at 60–120fps during a live call burned CPU/battery for
    // no visible gain on a breathing ring. The shimmer phase (tRef) is
    // dt-scaled so the animation speed is identical to the unthrottled one.
    const MIN_FRAME_MS = 66;
    let last = 0;
    const tick = (t: number) => {
      rafRef.current = requestAnimationFrame(tick);
      if (t - last < MIN_FRAME_MS) return;
      const step = Math.max(1, Math.round((t - last) / MIN_FRAME_MS));
      last = t;
      tRef.current += step;
      // NOTE: deliberately NOT gated on `muted` — that's the user's mic.
      // The analyser taps the model's output bus, so the agent keeps
      // visually "speaking" even while the customer is muted.
      if (isConnected) {
        setAmp(getSpeakingAmplitude());
      } else if (isRinging) {
        // Steady synthetic pulse while ringing — the alpha "breathes".
        const phase = (tRef.current % 15) / 15; // 0..1 (15 frames ≈ 1s @15fps)
        setAmp(0.3 + 0.3 * Math.sin(phase * Math.PI * 2));
      } else {
        setAmp(0);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [show, isConnected, isRinging, getSpeakingAmplitude]);

  // No status label in the wavebeat — the pulse itself conveys live state,
  // and the header already shows the timer / "Ringing…" text. Keeping only
  // the brand caption for identity.
  const speaking = amp > 0.05 || isRinging;

  // 24 ticks arranged radially around the alpha — the "ticks along the tape"
  // motif (Brand Book §02), here scaled by amplitude into a circular wavebeat.
  const TICKS = 24;
  const ticks = Array.from({ length: TICKS });
  const R = 30; // base ring radius (viewBox 0..100, center 50)
  const CX = 50;
  const CY = 50;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: -16, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -16, scale: 0.9 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="relative z-10 mx-auto mt-2 flex w-fit max-w-[calc(100%-2rem)] items-center gap-3 rounded-pill px-3.5 py-2.5"
          style={{ background: "rgba(8,48,104,0.78)" }}
        >
          {/* Alpha + circular wavebeat */}
          <div className="relative flex h-14 w-14 shrink-0 items-center justify-center">
            {/* Concentric pulsing tape rings (the "speaking from the other side" pulse) */}
            {[0, 1, 2].map((ring) => (
              <motion.span
                key={ring}
                aria-hidden
                className="absolute rounded-full"
                style={{ border: "1.5px solid var(--draep-orange)", inset: 0 }}
                animate={speaking ? { scale: [1, 1.5 + ring * 0.12], opacity: [0.5, 0] } : { opacity: 0 }}
                transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut", delay: ring * 0.4 }}
              />
            ))}

            {/* Radial tick wavebeat */}
            <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" aria-hidden>
              {ticks.map((_, i) => {
                const angle = (i / TICKS) * Math.PI * 2 - Math.PI / 2;
                // Each tick's length is driven by amplitude + a per-tick phase
                // so the ring shimmers like a real waveform.
                const phase = Math.sin(tRef.current * 0.22 + i * 0.9) * 0.5 + 0.5; // 0..1
                const len = 3 + amp * 12 * (0.4 + phase * 0.6);
                const r1 = R;
                const r2 = R + len;
                const x1 = CX + Math.cos(angle) * r1;
                const y1 = CY + Math.sin(angle) * r1;
                const x2 = CX + Math.cos(angle) * r2;
                const y2 = CY + Math.sin(angle) * r2;
                return (
                  <line
                    key={i}
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke={speaking ? "var(--draep-orange)" : "rgba(255,255,255,0.35)"}
                    strokeWidth={1.6}
                    strokeLinecap="round"
                    style={{ transition: "stroke 200ms" }}
                  />
                );
              })}
            </svg>

            {/* Draep alpha at the center — the official logo mark (Brand Book §08 —
                "lead with the symbol for icons & avatars"). PNG on white reads as a
                crisp disc with the orange tape-alpha, which pops on the navy pill. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo_alpha_icon.png"
              alt="draep"
              className="relative h-9 w-9 rounded-full object-cover ring-2 ring-white/70"
            />
          </div>

          <div className="flex flex-col">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-draep-orange">
              draep · stylist
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ============================================================ */
/*  Control dock — round buttons (navy + tape active) + end call */
/* ============================================================ */

function ControlDock({
  muted,
  videoOn,
  onToggleMute,
  onToggleVideo,
  onEnd,
}: {
  muted: boolean;
  videoOn: boolean;
  onToggleMute: () => void;
  onToggleVideo: () => void;
  onEnd: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className="mx-auto flex w-full max-w-md items-center justify-center gap-8"
    >
      <RoundControl onClick={onToggleMute} active={muted} label={muted ? strings.stylist.unmute : strings.stylist.mute}>
        <MicIcon muted={muted} />
      </RoundControl>

      <RoundControl onClick={onToggleVideo} active={!videoOn} label={videoOn ? strings.stylist.videoOff : strings.stylist.videoOn}>
        <VideoIcon on={videoOn} />
      </RoundControl>

      {/* End call — semantic error red, flat circle. Handset points
          down-left (standard end-call orientation). Always enabled: the user
          must be able to cancel out of a stuck "Calling…" phase (e.g. a
          permission prompt that never surfaces) from the main control. */}
      <button
        type="button"
        onClick={onEnd}
        aria-label={strings.stylist.endCall}
        className="flex h-[68px] w-[68px] items-center justify-center rounded-full text-white transition-transform hover:scale-105 active:scale-95"
        style={{ background: "var(--error)" }}
      >
        <EndCallIcon />
      </button>
    </motion.div>
  );
}

function RoundControl({
  onClick,
  active,
  label,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  label: string;
  children: React.ReactNode;
}) {
  // Idle → translucent navy circle with white icon; active (muted / cam off)
  // → tape-gradient fill (Brand Book: orange is the accent for active states).
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex h-[58px] w-[58px] items-center justify-center rounded-full transition-transform hover:scale-105 active:scale-95"
      style={{
        background: active ? "var(--tape-gradient)" : "rgba(255,255,255,0.16)",
        color: "#ffffff",
      }}
    >
      {children}
    </button>
  );
}

/* ============================================================ */
/*  SketchingCard — design rendering in progress                 */
/*  (pairs with the pencil-scratch audio from the call hook)     */
/* ============================================================ */

function SketchingCard({ count }: { count: number }) {
  return (
    <div
      className="overflow-hidden rounded-sheet px-4 py-3"
      style={{ background: "rgba(8,48,104,0.82)", border: "1px solid rgba(255,255,255,0.16)", boxShadow: "var(--shadow-brand)" }}
    >
      <div className="flex items-center gap-3">
        {/* Wiggling pencil — hand-sketching feel */}
        <motion.span
          aria-hidden
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-draep-orange"
          style={{ background: "rgba(255,255,255,0.08)" }}
          animate={{ rotate: [-7, 7, -7] }}
          transition={{ duration: 0.9, repeat: Infinity, ease: "easeInOut" }}
        >
          <PencilIcon />
        </motion.span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-chalk-white">
            {count > 1 ? `Sketching ${count} designs…` : strings.stylist.sketching}
          </p>
          {/* Indeterminate shimmer — we can't know image-gen ETA, so no percent */}
          <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/10">
            <motion.div
              className="h-full w-1/3 rounded-full"
              style={{ background: "var(--tape-gradient)" }}
              animate={{ x: ["-100%", "300%"] }}
              transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
            />
          </div>
        </div>

        <span className="shrink-0 text-caption text-chalk-white/50">{strings.stylist.sketchingHint}</span>
      </div>
    </div>
  );
}

/* ============================================================ */
/*  ConfirmExitSheet — back-arrow confirmation on a live call    */
/* ============================================================ */

function ConfirmExitSheet({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm"
      onClick={onCancel}
    >
      <motion.div
        initial={{ scale: 0.94, y: 16 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.94, y: 16 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-exit-title"
        className="w-full max-w-md rounded-sheet bg-warm-sand p-5"
        style={{ boxShadow: "var(--shadow-card)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-exit-title" className="font-heading text-lg font-semibold text-ink-navy">
          {strings.stylist.endCallTitle}
        </h2>
        <p className="mt-1.5 text-body leading-relaxed text-ink-navy/60">
          {strings.stylist.endCallBody}
        </p>

        <div className="mt-5 flex flex-col gap-2">
          {/* Safe action first and focused — one stray tap shouldn't lose the call */}
          <button
            type="button"
            onClick={onCancel}
            autoFocus
            className="rounded-pill px-6 py-3 text-body font-semibold text-chalk-white transition-all hover:brightness-105 active:scale-[0.98] bg-tape"
            style={{ boxShadow: "var(--shadow-primary)" }}
          >
            {strings.stylist.keepCalling}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-pill px-6 py-3 text-body font-medium transition-colors hover:bg-mist-navy"
            style={{ border: "1px solid var(--error-border)", color: "var(--error-text)" }}
          >
            {strings.stylist.endNow}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ============================================================ */
/*  Pre-call screen — warm sand calling card                    */
/* ============================================================ */

function PreCallScreen({
  hasError,
  errorMsg,
  onStart,
  onBack,
}: {
  hasError: boolean;
  errorMsg: string | null;
  onStart: () => void;
  onBack: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[200] flex flex-col overflow-hidden bg-warm-sand">
      {/* Tape top edge — the brand signature trim (§09) */}
      <div aria-hidden className="h-1.5 w-full bg-tape" />

      {/* Top bar */}
      <div className="relative z-10 flex items-center justify-between px-5 pt-[max(1.25rem,env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={onBack}
          aria-label={strings.stylist.back}
          className="flex h-10 w-10 items-center justify-center rounded-pill bg-white text-ink-navy shadow-card transition-colors hover:bg-mist-navy"
        >
          <ArrowLeft size={20} />
        </button>

        {/* Eyebrow label — mono, tracked (§05) */}
        <span className="font-mono text-eyebrow font-medium uppercase text-ember">
          Live Consultation
        </span>

        <div className="w-10" />
      </div>

      {/* ─── Caller card (centered, scrolls on short screens) ─── */}
      <div className="relative z-10 flex flex-1 flex-col items-center justify-center overflow-y-auto px-7 py-6 text-center">
        {/* Draep alpha avatar on a navy disc — "lead with the symbol" (§08) */}
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="relative mb-6"
        >
          {/* Draep alpha avatar — the official PNG mark (§08 — "lead with the
              symbol for icons & avatars"). The mark's white field sits inside
              the navy ring as a crisp disc with the orange tape-alpha. */}
          <div className="flex h-28 w-28 items-center justify-center rounded-full bg-ink-navy p-2 shadow-card">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo_alpha_icon.png"
              alt="draep"
              className="h-full w-full rounded-full object-cover"
            />
          </div>
          {/* Rivet dot — tape-end motif (§06) */}
          <span
            aria-hidden
            className="absolute right-2 top-2 h-3 w-3 rounded-full"
            style={{ background: "var(--draep-orange)", boxShadow: "0 0 0 3px var(--warm-sand)" }}
          />
        </motion.div>

        {/* Name */}
        <motion.h1
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08 }}
          className="font-heading text-h1 font-semibold leading-tight text-ink-navy"
        >
          Your AI Fashion Designer
        </motion.h1>

        {/* Copy */}
        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.14 }}
          className="mt-2 max-w-xs text-body leading-relaxed text-ink-navy/60"
        >
          A live video consultation that guides you to a blouse made for you — your cut, your fit, your fabric.
        </motion.p>

        {/* Tick divider (§06 motif) */}
        <motion.div
          aria-hidden
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="my-6 flex items-center gap-1.5"
        >
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className="w-px h-3 bg-ink-navy/20" style={{ opacity: 1 - i * 0.15 }} />
          ))}
        </motion.div>

        {/* ─── Prep tips — set the customer up BEFORE dialing ─── */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.26 }}
          className="w-full max-w-sm rounded-card bg-white p-4 text-left shadow-card"
        >
          <p className="mb-3 font-mono text-eyebrow font-medium uppercase tracking-[0.18em] text-ember">
            {strings.stylist.prepTitle}
          </p>
          <div className="flex flex-col gap-3.5">
            <PrepTip icon={<SunIcon />} title={strings.stylist.prepLightTitle} body={strings.stylist.prepLightBody} />
            <PrepTip icon={<PersonIcon />} title={strings.stylist.prepFrameTitle} body={strings.stylist.prepFrameBody} />
            <PrepTip icon={<HeadphonesIcon />} title={strings.stylist.prepQuietTitle} body={strings.stylist.prepQuietBody} />
          </div>
        </motion.div>

        {hasError && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-2 w-full max-w-md overflow-y-auto rounded-card px-4 py-3"
            style={{ background: "var(--error-bg)", border: "1px solid var(--error-border)" }}
          >
            <p
              className="whitespace-pre-wrap break-words text-left text-sm leading-relaxed text-error-text"
              style={{ maxHeight: "30vh" }}
            >
              {errorMsg ?? strings.stylist.errorTitle}
            </p>
          </motion.div>
        )}
      </div>

      {/* ─── Footer: start button ─── */}
      <div className="relative z-10 px-7 pb-[max(2rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={onStart}
          className="flex w-full items-center justify-center gap-3 rounded-pill px-6 py-4 text-body font-semibold text-chalk-white transition-all hover:brightness-105 active:scale-[0.98] bg-tape"
          style={{ boxShadow: "var(--shadow-primary)" }}
        >
          <VideoIcon on />
          {strings.stylist.startCall}
        </button>
        <p className="mt-3 text-center text-caption text-ink-navy/45">
          Camera &amp; mic required · You can end anytime
        </p>
      </div>
    </div>
  );
}

/* ============================================================ */
/*  Prep tip row — icon disc + title/body                        */
/* ============================================================ */

function PrepTip({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="flex items-start gap-3">
      <span
        aria-hidden
        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink-navy text-chalk-white"
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold leading-snug text-ink-navy">{title}</p>
        <p className="mt-0.5 text-caption leading-snug text-ink-navy/55">{body}</p>
      </div>
    </div>
  );
}

/* ============================================================ */
/*  Error modal — human first, protocol detail demoted to a      */
/*  tiny mono debug line (it's for us, not the customer)         */
/* ============================================================ */

function ErrorModal({
  errorMsg,
  closeDetail,
  onBack,
  onRetry,
}: {
  errorMsg: string | null;
  closeDetail: CloseDetail | null;
  onBack: () => void;
  onRetry: () => void;
}) {
  const debugLine = closeDetail
    ? [
        `ws ${closeDetail.code}`,
        closeDetail.wasClean ? "clean close" : "abnormal close",
        closeDetail.reason,
        errorMsg,
      ]
        .filter(Boolean)
        .join(" · ")
    : errorMsg;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/85 px-4 backdrop-blur-md"
    >
      <motion.div
        initial={{ scale: 0.92, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.92, y: 20 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-md overflow-hidden rounded-sheet bg-warm-sand"
        style={{ boxShadow: "var(--shadow-card)" }}
      >
        <div
          className="flex items-center gap-2 px-5 py-3.5"
          style={{ background: "var(--error-bg)", borderBottom: "1px solid var(--error-border)" }}
        >
          <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="text-error" aria-hidden>
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span className="text-sm font-semibold text-ink-navy">{strings.stylist.callDroppedTitle}</span>
        </div>

        <div className="px-5 py-4">
          <p className="text-body leading-relaxed text-ink-navy/70">
            {strings.stylist.callDroppedBody}
          </p>

          {/* One-line mono debug strip — protocol detail for support/dev */}
          {debugLine && (
            <p className="mt-3 max-h-16 overflow-y-auto whitespace-pre-wrap break-words rounded-card bg-mist-navy px-3 py-2 font-mono text-[11px] leading-relaxed text-ink-navy/45">
              {debugLine}
            </p>
          )}
        </div>

        <div className="flex gap-2 px-5 py-3.5" style={{ borderTop: "1px solid var(--hairline)" }}>
          <button
            type="button"
            onClick={onBack}
            className="flex-1 rounded-pill px-4 py-2.5 text-sm font-medium text-ink-navy transition-colors hover:bg-mist-navy"
            style={{ border: "1px solid var(--hairline-strong)" }}
          >
            {strings.stylist.back}
          </button>
          <button
            type="button"
            onClick={onRetry}
            className="flex-1 rounded-pill px-4 py-2.5 text-sm font-semibold text-chalk-white transition-all hover:brightness-105 active:scale-95 bg-tape"
            style={{ boxShadow: "var(--shadow-primary)" }}
          >
            {strings.stylist.errorRetry}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ============================================================ */
/*  Design gallery — stepper through all generated previews     */
/* ============================================================ */

function DesignGallery({ designs }: { designs: DesignImage[] }) {
  const [activeIdx, setActiveIdx] = useState(designs.length - 1);
  const [fullscreen, setFullscreen] = useState(false);

  // New designs auto-advance ONLY if the user was already on the latest one.
  // If they're browsing an older design, don't yank the view away — mark the
  // next-stepper with a rivet dot instead so the arrival is discoverable.
  const activeIdxRef = useRef(activeIdx);
  const prevLenRef = useRef(designs.length);
  activeIdxRef.current = activeIdx;

  useEffect(() => {
    const wasViewingLatest = activeIdxRef.current >= prevLenRef.current - 1;
    prevLenRef.current = designs.length;
    if (wasViewingLatest) {
      setActiveIdx(designs.length - 1);
    }
  }, [designs.length]);

  const design = designs[Math.min(activeIdx, designs.length - 1)];

  return (
    <div
      className="overflow-hidden rounded-sheet"
      style={{ background: "rgba(8,48,104,0.82)", border: "1px solid rgba(255,255,255,0.16)", boxShadow: "var(--shadow-brand)" }}
    >
      <div className="flex items-center justify-between px-4 pt-3">
        <div className="flex items-center gap-1.5">
          <DraepSymbol variant="color" className="h-3.5 w-3.5" />
          <span className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-chalk-white/70">
            {strings.stylist.designsLabel} · {String(activeIdx + 1).padStart(2, "0")}/{String(designs.length).padStart(2, "0")}
          </span>
        </div>

        {/* Prev / next stepper (only when >1 design) */}
        {designs.length > 1 && (
          <div className="flex items-center gap-1">
            <StepperButton dir="prev" disabled={activeIdx === 0} onClick={() => setActiveIdx((i) => Math.max(0, i - 1))} />
            <StepperButton
              dir="next"
              disabled={activeIdx === designs.length - 1}
              notify={activeIdx < designs.length - 1}
              onClick={() => setActiveIdx((i) => Math.min(designs.length - 1, i + 1))}
            />
          </div>
        )}

        <button
          type="button"
          onClick={() => setFullscreen(true)}
          className="flex items-center gap-1 rounded-pill px-2.5 py-1 text-[11px] font-medium text-chalk-white/85 transition-colors hover:bg-white/10"
        >
          Expand
          <ExpandIcon />
        </button>
      </div>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={design.url}
        alt={design.description}
        className="mt-2 max-h-[30vh] w-full cursor-zoom-in object-contain"
        onClick={() => setFullscreen(true)}
      />
      {design.description && (
        <p className="px-4 pb-3 pt-2 text-[11px] leading-snug text-chalk-white/55 line-clamp-2">
          {design.description}
        </p>
      )}

      <AnimatePresence>
        {fullscreen && (
          <motion.div
            className="fixed inset-0 z-[300] flex items-center justify-center bg-black/95 px-4 backdrop-blur-md"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setFullscreen(false)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={design.url} alt={design.description} className="max-h-[88vh] max-w-[94vw] rounded-sheet object-contain" />
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setFullscreen(false); }}
              className="absolute right-5 top-[max(1rem,env(safe-area-inset-top))] flex h-10 w-10 items-center justify-center rounded-full text-chalk-white"
              style={{ background: "rgba(255,255,255,0.12)" }}
              aria-label="Close"
            >
              <CloseX />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function StepperButton({
  dir,
  disabled,
  notify,
  onClick,
}: {
  dir: "prev" | "next";
  disabled: boolean;
  /** Rivet dot — a newer design exists past this direction. */
  notify?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={dir === "prev" ? "Previous design" : "Next design"}
      className="relative flex h-7 w-7 items-center justify-center rounded-full text-chalk-white/85 transition-colors hover:bg-white/10 disabled:opacity-30"
      style={{ background: "rgba(255,255,255,0.08)" }}
    >
      {dir === "prev" ? <ChevronLeft /> : <ChevronRight />}
      {notify && !disabled && (
        <motion.span
          aria-hidden
          className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full"
          style={{ background: "var(--draep-orange)", boxShadow: "0 0 0 2px rgba(8,48,104,0.9)" }}
          animate={{ scale: [1, 1.25, 1] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
        />
      )}
    </button>
  );
}

/* ============================================================ */
/*  Icons                                                       */
/* ============================================================ */

function MicIcon({ muted }: { muted: boolean }) {
  return (
    <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {muted ? (
        <>
          <line x1="1" y1="1" x2="23" y2="23" />
          <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
          <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
          <line x1="12" y1="19" x2="12" y2="23" />
        </>
      ) : (
        <>
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="23" />
          <line x1="8" y1="23" x2="16" y2="23" />
        </>
      )}
    </svg>
  );
}

function VideoIcon({ on }: { on: boolean }) {
  return (
    <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {on ? (
        <>
          <path d="M23 7l-7 5 7 5V7z" />
          <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
        </>
      ) : (
        <>
          <path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </>
      )}
    </svg>
  );
}

function EndCallIcon() {
  // Classic phone handset. The path is drawn pointing up-right; we rotate it
  // 135° so the handset points down-left — the standard "end call" glyph used
  // by every native dialer. (Without this it looks upside-down.)
  return (
    <svg width={26} height={26} viewBox="0 0 24 24" fill="currentColor" aria-hidden style={{ transform: "rotate(135deg)" }}>
      <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 0 0-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z" />
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  );
}

function ChevronLeft() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function CloseX() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function HeadphonesIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
      <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  );
}
