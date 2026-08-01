"use client";

/**
 * DesignerCall — full-screen WhatsApp-style video call with the AI fashion designer.
 *
 * Layout:
 *   ┌────────────────────────────────┐
 *   │  [self-view video, mirrored]    │  ← full-screen camera
 *   │                                 │
 *   │  ┌─ Designer avatar ─┐          │  ← top: designer "avatar" + status
 *   │  │  AI Stylist        │          │
 *   │  │  Speaking…         │          │
 *   │  └────────────────────┘          │
 *   │                                 │
 *   │  ┌─ Design preview (if any) ─┐  │  ← slides up when a design is generated
 *   │  │  [generated image]         │  │
 *   │  └────────────────────────────┘  │
 *   │                                 │
 *   │  ┌─ Transcript (recent) ──────┐  │  ← live captions
 *   │  │  Designer: I recommend...   │  │
 *   │  └────────────────────────────┘  │
 *   │                                 │
 *   │     [mute]    [end call]         │  ← bottom controls
 *   └────────────────────────────────┘
 */

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

import { ArrowLeft, Sparkles } from "@/components/ui/icons";
import { strings } from "@/lib/strings";
import type { CallStatus, DesignImage, TranscriptEntry } from "@/hooks/useGeminiLiveCall";

interface Props {
  status: CallStatus;
  transcript: TranscriptEntry[];
  designImages: DesignImage[];
  errorMsg: string | null;
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

  // Auto-scroll transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  // ── Idle / pre-call screen ──────────────────────────────────────────
  if (status === "idle" || status === "error") {
    return (
      <PreCallScreen
        hasError={status === "error"}
        errorMsg={errorMsg}
        onStart={onConnect}
        onBack={onBack}
      />
    );
  }

  // ── Active call screen ──────────────────────────────────────────────
  const isConnected = status === "connected";

  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-ink-navy">
      {/* Hidden canvas for frame capture */}
      <canvas ref={canvasRef} className="hidden" />

      {/* ─── Full-screen self-view video (mirrored like WhatsApp) ─── */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="absolute inset-0 h-full w-full object-cover"
        style={{ transform: "scaleX(-1)" }}
      />

      {/* Dark gradient overlay for readability */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(8,48,104,0.55) 0%, transparent 25%, transparent 55%, rgba(8,48,104,0.75) 100%)",
        }}
      />

      {/* ─── Top bar: back + designer identity ─── */}
      <div className="relative z-10 flex items-start justify-between px-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            aria-label={strings.stylist.back}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-chalk-white/15 text-chalk-white backdrop-blur-md transition-colors hover:bg-chalk-white/25"
          >
            <ArrowLeft size={20} />
          </button>
        </div>

        {/* Designer "avatar" — like WhatsApp contact header */}
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col items-center gap-1.5"
        >
          <div className="relative">
            <div
              className="flex h-14 w-14 items-center justify-center rounded-full text-chalk-white shadow-lg"
              style={{ backgroundImage: "var(--tape-gradient)" }}
            >
              <Sparkles size={24} />
            </div>
            {/* Pulsing ring when speaking */}
            {isConnected && (
              <motion.div
                aria-hidden
                className="absolute inset-0 rounded-full border-2"
                style={{ borderColor: "var(--draep-orange)" }}
                animate={{ scale: [1, 1.25, 1], opacity: [0.6, 0, 0.6] }}
                transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
              />
            )}
          </div>
          <p className="text-caption font-semibold text-chalk-white">
            AI Fashion Designer
          </p>
          <p className="text-[11px] text-chalk-white/70">
            {status === "connecting"
              ? strings.stylist.connecting
              : isConnected
                ? strings.stylist.connected
                : strings.stylist.ended}
          </p>
        </motion.div>

        {/* Spacer */}
        <div className="w-10" />
      </div>

      {/* ─── Design preview overlay (slides up when generated) ─── */}
      <AnimatePresence>
        {latestDesign && (
          <motion.div
            key={latestDesign.id}
            initial={{ opacity: 0, y: 40, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 40 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="relative z-10 mx-auto mt-4 w-full max-w-[calc(100%-2rem)]"
          >
            <DesignPreview design={latestDesign} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Spacer (flex-grow pushes controls to bottom) ─── */}
      <div className="flex-1" />

      {/* ─── Live transcript (recent messages) ─── */}
      {transcript.length > 0 && (
        <div className="relative z-10 max-h-32 overflow-y-auto px-4 pb-2">
          <div className="flex flex-col gap-1.5">
            {transcript.slice(-4).map((entry) => (
              <TranscriptBubble key={entry.id} entry={entry} />
            ))}
          </div>
          <div ref={transcriptEndRef} />
        </div>
      )}

      {/* ─── Bottom controls (WhatsApp style) ─── */}
      <div className="relative z-10 flex items-center justify-center gap-6 px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-2">
        {/* Mute button */}
        <CallButton
          onClick={onToggleMute}
          active={muted}
          label={muted ? strings.stylist.unmute : strings.stylist.mute}
        >
          <MicIcon muted={muted} />
        </CallButton>

        {/* End call button */}
        <button
          type="button"
          onClick={onDisconnect}
          aria-label={strings.stylist.endCall}
          className="flex h-16 w-16 items-center justify-center rounded-full bg-error text-chalk-white shadow-lg transition-transform hover:scale-105 active:scale-95"
        >
          <EndCallIcon />
        </button>
      </div>
    </div>
  );
}

/* ============================================================ */
/*  Pre-call screen                                              */
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
    <div className="fixed inset-0 z-[200] flex flex-col bg-ink-navy">
      {/* Decorative gradient orb */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full opacity-25 blur-3xl"
        style={{ background: "var(--tape-gradient)" }}
      />

      {/* Back button */}
      <div className="relative z-10 px-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={onBack}
          aria-label={strings.stylist.back}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-chalk-white/15 text-chalk-white backdrop-blur-md transition-colors hover:bg-chalk-white/25"
        >
          <ArrowLeft size={20} />
        </button>
      </div>

      {/* Center content */}
      <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 text-center">
        {/* Designer avatar */}
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="relative mb-6"
        >
          <div
            className="flex h-24 w-24 items-center justify-center rounded-full text-chalk-white shadow-2xl"
            style={{ backgroundImage: "var(--tape-gradient)" }}
          >
            <Sparkles size={36} />
          </div>
          <motion.div
            aria-hidden
            className="absolute inset-0 rounded-full border-2"
            style={{ borderColor: "var(--draep-orange)" }}
            animate={{ scale: [1, 1.15, 1], opacity: [0.5, 0, 0.5] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          />
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
          className="mt-2 max-w-xs text-body text-chalk-white/70"
        >
          {strings.stylist.startCallBody}
        </motion.p>

        {/* Feature points */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="mt-6 flex flex-col gap-2"
        >
          {[
            "Video consultation with our AI designer",
            "Get personalised blouse recommendations",
            "See designs on you in real time",
          ].map((point) => (
            <div
              key={point}
              className="flex items-center gap-2 rounded-pill bg-chalk-white/10 px-3 py-1.5 backdrop-blur-sm"
            >
              <span
                aria-hidden
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: "var(--draep-orange)" }}
              />
              <span className="text-caption text-chalk-white/90">{point}</span>
            </div>
          ))}
        </motion.div>

        {/* Error message */}
        {hasError && (
          <div className="mt-6 w-full max-w-md overflow-y-auto rounded-card border border-error/30 bg-error/10 px-4 py-3">
            <p
              className="whitespace-pre-wrap break-words text-left text-sm leading-relaxed text-error-text"
              style={{ maxHeight: "30vh", fontFamily: "var(--font-mono, ui-monospace, monospace)" }}
            >
              {errorMsg ?? strings.stylist.errorTitle}
            </p>
          </div>
        )}

        {/* Camera permission note */}
        {!hasError && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="mt-6 flex items-center gap-1.5 text-[11px] text-chalk-white/50"
          >
            <CameraSmall />
            {strings.stylist.camPermissionBody}
          </motion.p>
        )}
      </div>

      {/* Start call button */}
      <div className="relative z-10 px-6 pb-[max(2rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={onStart}
          className="flex w-full items-center justify-center gap-2 rounded-pill px-6 py-4 text-body font-semibold text-chalk-white shadow-primary transition-all hover:brightness-105 active:scale-[0.98]"
          style={{ backgroundImage: "var(--tape-gradient)" }}
        >
          <PhoneIcon />
          {strings.stylist.startCall}
        </button>
      </div>
    </div>
  );
}

/* ============================================================ */
/*  Design preview card                                          */
/* ============================================================ */

function DesignPreview({ design }: { design: DesignImage }) {
  const [fullscreen, setFullscreen] = useState(false);

  return (
    <>
      <div className="overflow-hidden rounded-card border border-chalk-white/20 bg-ink-navy/80 shadow-card backdrop-blur-md">
        <div className="flex items-center justify-between px-3 pt-2">
          <div className="flex items-center gap-1.5">
            <Sparkles size={12} className="text-draep-orange" />
            <span className="text-[11px] font-semibold uppercase tracking-wide text-chalk-white/80">
              {strings.stylist.designsLabel}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setFullscreen(true)}
            className="text-[11px] font-medium text-chalk-white/70 underline-offset-2 hover:underline"
          >
            Expand
          </button>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={design.url}
          alt={design.description}
          className="mt-1.5 max-h-[35vh] w-full cursor-zoom-in object-contain"
          onClick={() => setFullscreen(true)}
        />
      </div>

      {/* Fullscreen overlay */}
      <AnimatePresence>
        {fullscreen && (
          <motion.div
            className="fixed inset-0 z-[300] flex items-center justify-center bg-ink-navy/95 backdrop-blur-md"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setFullscreen(false)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={design.url}
              alt={design.description}
              className="max-h-[90vh] max-w-[95vw] rounded-card object-contain"
            />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/* ============================================================ */
/*  Transcript bubble                                            */
/* ============================================================ */

function TranscriptBubble({ entry }: { entry: TranscriptEntry }) {
  const isModel = entry.role === "model";
  return (
    <div className={`flex ${isModel ? "justify-start" : "justify-end"}`}>
      <div
        className={
          "max-w-[85%] rounded-pill px-3 py-1.5 text-caption leading-snug backdrop-blur-sm " +
          (isModel
            ? "rounded-bl-sm bg-chalk-white/90 text-ink-navy"
            : "rounded-br-sm text-chalk-white")
        }
        style={
          isModel
            ? undefined
            : { backgroundImage: "var(--tape-gradient)" }
        }
      >
        {isModel && (
          <span className="mr-1 text-[10px] font-semibold uppercase text-accent-text">
            Designer
          </span>
        )}
        {entry.text}
      </div>
    </div>
  );
}

/* ============================================================ */
/*  Call control button                                          */
/* ============================================================ */

function CallButton({
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
      className={
        "flex h-14 w-14 items-center justify-center rounded-full backdrop-blur-md transition-transform hover:scale-105 active:scale-95 " +
        (active
          ? "bg-draep-orange text-chalk-white"
          : "bg-chalk-white/15 text-chalk-white")
      }
    >
      {children}
    </button>
  );
}

/* ============================================================ */
/*  Icons                                                        */
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
