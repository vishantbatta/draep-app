"use client";

/**
 * DesignerCall — full-screen video call with the AI fashion designer.
 *
 * Design language (Brand Book):
 *   - ink-navy dark surface, tape-gradient accents, chalk-white glass cards
 *   - Poppins headings, Inter body, Plex Mono eyebrow labels
 *   - rounded cards/sheets (12–16px), warm two-layer elevation
 *
 * Layout (active call):
 *   ┌────────────────────────────────┐
 *   │   ┌─ glass header chip ────┐    │  ← avatar + name + status + timer + EQ
 *   │   │ ◉ AI Designer • 0:42 ▮▮▮│    │
 *   │   └────────────────────────┘    │
 *   │      [ camera full-bleed ]      │
 *   │   ┌─ design preview sheet ─┐    │  ← slides up when generated
 *   │   │  [generated image]      │    │
 *   │   └────────────────────────┘    │
 *   │   ┌─ live transcript ──────┐    │
 *   │   │ Designer: I recommend…  │    │
 *   │   └────────────────────────┘    │
 *   │   ┌── control dock (glass) ─┐   │  ← mic + end call, floating pill
 *   │   └────────────────────────┘    │
 *   └────────────────────────────────┘
 */

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

import { ArrowLeft, Sparkles } from "@/components/ui/icons";
import { strings } from "@/lib/strings";
import type { CallStatus, CloseDetail, DesignImage, TranscriptEntry } from "@/hooks/useGeminiLiveCall";

interface Props {
  status: CallStatus;
  transcript: TranscriptEntry[];
  designImages: DesignImage[];
  errorMsg: string | null;
  closeDetail: CloseDetail | null;
  muted: boolean;
  videoRef: React.RefObject<HTMLVideoElement>;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  onConnect: () => void;
  onDisconnect: () => void;
  onToggleMute: () => void;
  onBack: () => void;
}

export function DesignerCall({
  status,
  transcript,
  designImages,
  errorMsg,
  closeDetail,
  muted,
  videoRef,
  canvasRef,
  onConnect,
  onDisconnect,
  onToggleMute,
  onBack,
}: Props) {
  const latestDesign = designImages[designImages.length - 1] ?? null;
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  if (status === "idle" || status === "error") {
    return (
      <PreCallScreen hasError={status === "error"} errorMsg={errorMsg} onStart={onConnect} onBack={onBack} />
    );
  }

  const isConnected = status === "connected";
  const isReconnecting = status === "reconnecting";
  const isLive = isConnected || isReconnecting;
  const showCallError =
    (status === "connecting" || status === "connected" || isReconnecting) && !!errorMsg;

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

      {/* Cinematic gradient overlays (top + bottom for readability) */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(8,48,104,0.65) 0%, rgba(8,48,104,0.05) 22%, rgba(8,48,104,0.05) 55%, rgba(8,48,104,0.55) 78%, rgba(8,48,104,0.92) 100%)",
        }}
      />

      {/* ─── Top row: back button + glass header chip ─── */}
      <div className="relative z-10 flex items-start gap-3 px-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={onBack}
          aria-label={strings.stylist.back}
          className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-chalk-white/12 text-chalk-white backdrop-blur-xl transition-colors hover:bg-chalk-white/20"
          style={{ border: "1px solid rgba(255,255,255,0.14)" }}
        >
          <ArrowLeft size={20} />
        </button>

        <GlassHeaderChip
          isConnected={isConnected}
          isReconnecting={isReconnecting}
          isConnecting={status === "connecting"}
          muted={muted}
        />

        {/* balance spacer for the centered chip */}
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
            className="relative z-10 mx-auto mt-3 flex w-full max-w-[calc(100%-2.5rem)] items-center justify-center gap-2 rounded-pill px-4 py-2 backdrop-blur-xl"
            style={{ background: "rgba(8,48,104,0.7)", border: "1px solid rgba(255,255,255,0.14)" }}
          >
            <motion.span
              aria-hidden
              className="h-2 w-2 rounded-full bg-draep-orange"
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
            />
            <span className="text-caption font-medium text-chalk-white/90">
              Connection dipped — reconnecting you to the designer
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Design preview sheet ─── */}
      <AnimatePresence>
        {latestDesign && (
          <motion.div
            key={latestDesign.id}
            initial={{ opacity: 0, y: 48, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 48 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="relative z-10 mx-auto mt-4 w-full max-w-[calc(100%-2rem)]"
          >
            <DesignPreview design={latestDesign} index={designImages.length} />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex-1" />

      {/* ─── Live transcript ─── */}
      {transcript.length > 0 && (
        <div className="relative z-10 max-h-32 overflow-y-auto px-4 pb-3 [scrollbar-width:none]">
          <div className="flex flex-col gap-2">
            <AnimatePresence initial={false}>
              {transcript.slice(-4).map((entry) => (
                <TranscriptBubble key={entry.id} entry={entry} />
              ))}
            </AnimatePresence>
          </div>
          <div ref={transcriptEndRef} />
        </div>
      )}

      {/* ─── Floating glass control dock ─── */}
      <div className="relative z-10 px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-2">
        <ControlDock
          muted={muted}
          isLive={isLive}
          onToggleMute={onToggleMute}
          onEnd={onDisconnect}
        />
      </div>

      <AnimatePresence>
        {showCallError && (
          <ErrorModal errorMsg={errorMsg} closeDetail={closeDetail} onBack={onBack} onRetry={onConnect} />
        )}
      </AnimatePresence>
    </div>
  );
}

/* ============================================================ */
/*  Glass header chip — avatar, name, status, EQ, timer         */
/* ============================================================ */

function GlassHeaderChip({
  isConnected,
  isReconnecting,
  isConnecting,
  muted,
}: {
  isConnected: boolean;
  isReconnecting: boolean;
  isConnecting: boolean;
  muted: boolean;
}) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!isConnected) {
      setSeconds(0);
      return;
    }
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [isConnected]);

  const mm = String(Math.floor(seconds / 60)).padStart(1, "0");
  const ss = String(seconds % 60).padStart(2, "0");

  const statusText = isReconnecting
    ? "Reconnecting…"
    : isConnecting
      ? strings.stylist.connecting
      : isConnected
        ? (muted ? "Muted" : strings.stylist.connected)
        : strings.stylist.ended;

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-1 items-center gap-3 rounded-full px-3 py-2 backdrop-blur-xl"
      style={{ background: "rgba(8,48,104,0.55)", border: "1px solid rgba(255,255,255,0.14)", boxShadow: "var(--shadow-brand)" }}
    >
      {/* Avatar with live ring */}
      <div className="relative shrink-0">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-full text-chalk-white"
          style={{ backgroundImage: "var(--tape-gradient)" }}
        >
          <Sparkles size={16} />
        </div>
        {isConnected && (
          <motion.div
            aria-hidden
            className="absolute inset-0 rounded-full border-2"
            style={{ borderColor: "var(--draep-orange)" }}
            animate={{ scale: [1, 1.3, 1], opacity: [0.6, 0, 0.6] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
          />
        )}
      </div>

      {/* Name + status */}
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13px] font-semibold leading-tight text-chalk-white">
          AI Fashion Designer
        </span>
        <span className="flex items-center gap-1.5 text-[11px] leading-tight text-chalk-white/65">
          {/* status dot */}
          <span
            aria-hidden
            className="h-1.5 w-1.5 rounded-full"
            style={{
              background: isReconnecting ? "var(--draep-orange)" : isConnected ? "#34d399" : "rgba(255,255,255,0.5)",
            }}
          />
          {statusText}
          {isConnected && (
            <span className="font-mono tabular-nums text-chalk-white/45">· {mm}:{ss}</span>
          )}
        </span>
      </div>

      {/* EQ bars — animate while designer is speaking/connected */}
      <EqBars active={isConnected && !muted} />
    </motion.div>
  );
}

function EqBars({ active }: { active: boolean }) {
  // 4 bars; staggered animation only while active
  return (
    <div className="flex h-5 shrink-0 items-end gap-[3px]" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <motion.span
          key={i}
          className="w-[3px] rounded-full"
          style={{ background: "var(--draep-orange)" }}
          animate={
            active
              ? { height: ["35%", "100%", "55%", "85%", "35%"] }
              : { height: "35%" }
          }
          transition={
            active
              ? { duration: 0.9, repeat: Infinity, ease: "easeInOut", delay: i * 0.12 }
              : { duration: 0.2 }
          }
        />
      ))}
    </div>
  );
}

/* ============================================================ */
/*  Control dock — floating glass pill with mic + end call      */
/* ============================================================ */

function ControlDock({
  muted,
  isLive,
  onToggleMute,
  onEnd,
}: {
  muted: boolean;
  isLive: boolean;
  onToggleMute: () => void;
  onEnd: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className="mx-auto flex w-full max-w-sm items-center justify-center gap-4 rounded-full px-4 py-3 backdrop-blur-xl"
      style={{ background: "rgba(8,48,104,0.6)", border: "1px solid rgba(255,255,255,0.14)", boxShadow: "var(--shadow-brand)" }}
    >
      <DockButton onClick={onToggleMute} active={muted} label={muted ? strings.stylist.unmute : strings.stylist.mute}>
        <MicIcon muted={muted} />
      </DockButton>

      {/* End call — the hero control */}
      <button
        type="button"
        onClick={onEnd}
        aria-label={strings.stylist.endCall}
        className="flex h-16 w-16 items-center justify-center rounded-full text-chalk-white transition-transform hover:scale-105 active:scale-95"
        style={{ background: "var(--error)", boxShadow: "0 6px 20px rgba(220,38,38,0.4)" }}
      >
        <EndCallIcon />
      </button>

      {/* placeholder to balance the mic on the right */}
      <div className="w-14" aria-hidden />
    </motion.div>
  );
}

function DockButton({
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
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex h-14 w-14 items-center justify-center rounded-full transition-transform hover:scale-105 active:scale-95"
      style={{
        background: active ? "var(--draep-orange)" : "rgba(255,255,255,0.14)",
        color: "var(--chalk-white)",
        border: active ? "none" : "1px solid rgba(255,255,255,0.16)",
      }}
    >
      {children}
    </button>
  );
}

/* ============================================================ */
/*  Pre-call screen                                             */
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
    <div className="fixed inset-0 z-[200] flex flex-col overflow-hidden bg-ink-navy">
      {/* Ambient brand glows */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full opacity-30 blur-[80px]"
        style={{ background: "var(--tape-gradient)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-32 -left-24 h-80 w-80 rounded-full opacity-20 blur-[80px]"
        style={{ background: "var(--draep-orange)" }}
      />
      {/* subtle tape stripe at the very top */}
      <div aria-hidden className="h-1 w-full" style={{ background: "var(--tape-gradient)" }} />

      <div className="relative z-10 px-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={onBack}
          aria-label={strings.stylist.back}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-chalk-white/12 text-chalk-white backdrop-blur-xl transition-colors hover:bg-chalk-white/20"
          style={{ border: "1px solid rgba(255,255,255,0.14)" }}
        >
          <ArrowLeft size={20} />
        </button>
      </div>

      <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 text-center">
        {/* Eyebrow */}
        <motion.p
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="font-mono text-[11px] font-medium uppercase tracking-[0.2em] text-draep-orange"
        >
          Draep Atelier · Live
        </motion.p>

        {/* Avatar with halo */}
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="relative mb-7 mt-5"
        >
          <div
            className="flex h-28 w-28 items-center justify-center rounded-full text-chalk-white"
            style={{ backgroundImage: "var(--tape-gradient)", boxShadow: "0 12px 40px rgba(208,96,16,0.45)" }}
          >
            <Sparkles size={40} />
          </div>
          {[0, 1].map((ring) => (
            <motion.div
              key={ring}
              aria-hidden
              className="absolute inset-0 rounded-full border"
              style={{ borderColor: "rgba(248,144,16,0.5)" }}
              animate={{ scale: [1, 1.35], opacity: [0.5, 0] }}
              transition={{ duration: 2.2, repeat: Infinity, ease: "easeOut", delay: ring * 1.1 }}
            />
          ))}
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="font-heading text-h1 font-semibold text-chalk-white"
        >
          {strings.stylist.title}
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="mt-2 max-w-xs text-body text-chalk-white/65"
        >
          {strings.stylist.startCallBody}
        </motion.p>

        {/* Feature list */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="mt-7 flex w-full max-w-xs flex-col gap-2"
        >
          {[
            "Video consultation with our AI designer",
            "Get personalised blouse recommendations",
            "See designs on you in real time",
          ].map((point) => (
            <div
              key={point}
              className="flex items-center gap-2.5 rounded-card px-3.5 py-2 backdrop-blur-sm"
              style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)" }}
            >
              <Sparkles size={14} className="shrink-0 text-draep-orange" />
              <span className="text-caption text-left text-chalk-white/85">{point}</span>
            </div>
          ))}
        </motion.div>

        {hasError && (
          <div
            className="mt-6 w-full max-w-md overflow-y-auto rounded-card px-4 py-3"
            style={{ background: "var(--error-bg)", border: "1px solid var(--error-border)" }}
          >
            <p
              className="whitespace-pre-wrap break-words text-left text-sm leading-relaxed text-error-text"
              style={{ maxHeight: "30vh", fontFamily: "var(--font-mono, ui-monospace, monospace)" }}
            >
              {errorMsg ?? strings.stylist.errorTitle}
            </p>
          </div>
        )}

        {!hasError && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="mt-6 flex items-center gap-1.5 text-[11px] text-chalk-white/45"
          >
            <CameraSmall />
            {strings.stylist.camPermissionBody}
          </motion.p>
        )}
      </div>

      <div className="relative z-10 px-6 pb-[max(2rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={onStart}
          className="flex w-full items-center justify-center gap-2.5 rounded-pill px-6 py-4 text-body font-semibold text-chalk-white transition-all hover:brightness-105 active:scale-[0.98]"
          style={{ backgroundImage: "var(--tape-gradient)", boxShadow: "var(--shadow-primary)" }}
        >
          <PhoneIcon />
          {strings.stylist.startCall}
        </button>
      </div>
    </div>
  );
}

/* ============================================================ */
/*  Error modal                                                 */
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
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="fixed inset-0 z-[300] flex items-center justify-center bg-ink-navy/85 px-4 backdrop-blur-md"
    >
      <motion.div
        initial={{ scale: 0.92, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.92, y: 20 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-md overflow-hidden rounded-sheet bg-ink-navy"
        style={{ border: "1px solid var(--error-border)", boxShadow: "var(--shadow-card)" }}
      >
        <div
          className="flex items-center gap-2 px-5 py-3.5"
          style={{ background: "rgba(220,38,38,0.16)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}
        >
          <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="text-error" aria-hidden>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span className="text-sm font-semibold text-chalk-white">Call Disconnected</span>
        </div>

        <div className="px-5 py-4">
          {closeDetail && (
            <div className="mb-3 flex items-center gap-2">
              <span
                className="rounded-pill px-2.5 py-1 text-xs font-bold"
                style={{ background: "rgba(220,38,38,0.22)", color: "#fca5a5" }}
              >
                WS {closeDetail.code}
              </span>
              <span className="text-xs text-chalk-white/50">
                {closeDetail.wasClean ? "Clean close" : "Abnormal close"}
              </span>
            </div>
          )}

          <div className="rounded-card bg-ink-navy/60 p-3">
            <p
              className="whitespace-pre-wrap break-words text-left text-xs leading-relaxed text-chalk-white/80"
              style={{ fontFamily: "var(--font-mono, ui-monospace, monospace)" }}
            >
              {errorMsg ?? "Unknown error"}
            </p>
          </div>

          {closeDetail?.reason && (
            <p
              className="mt-2 text-left text-[11px] leading-relaxed text-chalk-white/40"
              style={{ fontFamily: "var(--font-mono, ui-monospace, monospace)" }}
            >
              {closeDetail.reason}
            </p>
          )}
        </div>

        <div className="flex gap-2 px-5 py-3.5" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
          <button
            type="button"
            onClick={onBack}
            className="flex-1 rounded-pill px-4 py-2.5 text-sm font-medium text-chalk-white transition-colors hover:bg-chalk-white/5"
            style={{ background: "rgba(255,255,255,0.1)" }}
          >
            Go Back
          </button>
          <button
            type="button"
            onClick={onRetry}
            className="flex-1 rounded-pill px-4 py-2.5 text-sm font-semibold text-chalk-white transition-all hover:brightness-105 active:scale-95"
            style={{ backgroundImage: "var(--tape-gradient)", boxShadow: "var(--shadow-primary)" }}
          >
            Try Again
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ============================================================ */
/*  Design preview sheet                                        */
/* ============================================================ */

function DesignPreview({ design, index }: { design: DesignImage; index: number }) {
  const [fullscreen, setFullscreen] = useState(false);

  return (
    <>
      <div
        className="overflow-hidden rounded-sheet backdrop-blur-xl"
        style={{ background: "rgba(8,48,104,0.78)", border: "1px solid rgba(255,255,255,0.16)", boxShadow: "var(--shadow-brand)" }}
      >
        <div className="flex items-center justify-between px-4 pt-3">
          <div className="flex items-center gap-1.5">
            <Sparkles size={13} className="text-draep-orange" />
            <span className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-chalk-white/70">
              {strings.stylist.designsLabel} · {String(index).padStart(2, "0")}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setFullscreen(true)}
            className="flex items-center gap-1 rounded-pill px-2.5 py-1 text-[11px] font-medium text-chalk-white/85 transition-colors hover:bg-chalk-white/10"
          >
            Expand
            <ExpandIcon />
          </button>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={design.url}
          alt={design.description}
          className="mt-2 max-h-[34vh] w-full cursor-zoom-in object-contain"
          onClick={() => setFullscreen(true)}
        />
        {design.description && (
          <p className="px-4 pb-3 pt-2 text-[11px] leading-snug text-chalk-white/55 line-clamp-2">
            {design.description}
          </p>
        )}
      </div>

      <AnimatePresence>
        {fullscreen && (
          <motion.div
            className="fixed inset-0 z-[300] flex items-center justify-center bg-ink-navy/95 px-4 backdrop-blur-md"
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
              style={{ background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.16)" }}
              aria-label="Close"
            >
              <CloseX />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/* ============================================================ */
/*  Transcript bubble                                           */
/* ============================================================ */

function TranscriptBubble({ entry }: { entry: TranscriptEntry }) {
  const isModel = entry.role === "model";
  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      className={`flex ${isModel ? "justify-start" : "justify-end"}`}
    >
      <div
        className="max-w-[85%] rounded-card px-3.5 py-2 text-caption leading-snug backdrop-blur-md"
        style={
          isModel
            ? { background: "rgba(255,255,255,0.92)", color: "var(--ink-navy)", borderBottomLeftRadius: 4 }
            : { backgroundImage: "var(--tape-gradient)", color: "var(--chalk-white)", borderBottomRightRadius: 4 }
        }
      >
        {isModel && (
          <span className="mr-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-accent-text">
            Designer
          </span>
        )}
        {entry.text}
      </div>
    </motion.div>
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

function EndCallIcon() {
  return (
    <svg width={26} height={26} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.956.956 0 0 1-.29-.7c0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48a.956.956 0 0 1-.71.29c-.27 0-.52-.1-.7-.28a11.27 11.27 0 0 0-2.67-1.85.996.996 0 0 1-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" transform="rotate(135 12 12)" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 0 0-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z" />
    </svg>
  );
}

function CameraSmall() {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
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

function CloseX() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
