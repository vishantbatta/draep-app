"use client";

/**
 * TryOnSheet — a bottom sheet that runs the AI virtual try-on.
 *
 * Stages:
 *   1. picker   — creative hero + how-it-works diagram + Upload / Capture
 *   2. loading  — branded AI animation while Replicate runs
 *   3. result   — the generated image with Try again / Done
 *   4. error    — recoverable error inline
 *
 * The picker uses two hidden <input type="file"> elements:
 *   • one with `accept="image/*"`              → OS shows Upload / File picker
 *   • one with `accept="image/*" capture="user"` → OS opens the front camera
 * On iOS and Android both inputs surface native OS-level options
 * ("Photo Library", "Take Photo", etc.) as requested.
 *
 * `onDone` is fired when the user taps Done on the result. The parent uses it
 * to reopen the design detail sheet that originally launched the try-on.
 */

import { AnimatePresence, motion } from "framer-motion";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import { BottomSheet } from "@/components/ui/BottomSheet";
import { Sparkles, Upload, Close } from "@/components/ui/icons";
import { tryOn } from "@/lib/api/tryon";
import { strings } from "@/lib/strings";
import { track } from "@/lib/analytics";

type Stage = "picker" | "loading" | "result" | "error";

interface Props {
  open: boolean;
  /** Closes the try-on sheet (used by backdrop / escape / close button). */
  onClose: () => void;
  /** Fired when the user taps "Done" on the result stage. */
  onDone?: () => void;
  /** Same-origin URL of the design/model image, e.g. "/designs/abc_hero.jpg". */
  designImageUrl: string;
  /** Optional title (the design label) for context in the sheet header. */
  designTitle?: string;
}

export function TryOnSheet({
  open,
  onClose,
  onDone,
  designImageUrl,
  designTitle,
}: Props) {
  const [stage, setStage] = useState<Stage>("picker");
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Hidden native inputs — one for upload, one for capture.
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const captureInputRef = useRef<HTMLInputElement>(null);

  // Reset whenever the sheet is reopened.
  useEffect(() => {
    if (open) {
      setStage("picker");
      setResultUrl(null);
      setErrorMsg(null);
    }
  }, [open]);

  const handleFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setStage("loading");
      setErrorMsg(null);
      track({ event: "tryon_started", design_image_url: designImageUrl });
      try {
        const out = await tryOn(file, designImageUrl);
        setResultUrl(out.output_url);
        setStage("result");
        track({ event: "tryon_succeeded", design_image_url: designImageUrl });
      } catch (err) {
        setErrorMsg(
          err instanceof Error
            ? err.message
            : "Something went wrong. Please try again.",
        );
        setStage("error");
        track({ event: "tryon_failed", design_image_url: designImageUrl });
      }
    },
    [designImageUrl],
  );

  // Reset the input value so the same file can be picked twice in a row.
  const resetInput = (el: HTMLInputElement | null) => {
    if (el) el.value = "";
  };

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={designTitle ?? strings.tryOn.sheetTitle}
    >
      {/* Hidden native inputs */}
      <input
        ref={uploadInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          void handleFile(e.target.files?.[0]);
          resetInput(uploadInputRef.current);
        }}
      />
      <input
        ref={captureInputRef}
        type="file"
        accept="image/*"
        capture="user"
        className="hidden"
        onChange={(e) => {
          void handleFile(e.target.files?.[0]);
          resetInput(captureInputRef.current);
        }}
      />

      <div className="pb-6">
        <AnimatePresence mode="wait">
          {stage === "picker" && (
            <PickerStage
              key="picker"
              designImageUrl={designImageUrl}
              onUpload={() => uploadInputRef.current?.click()}
              onCapture={() => captureInputRef.current?.click()}
            />
          )}
          {stage === "loading" && <LoadingStage key="loading" />}
          {stage === "result" && resultUrl && (
            <ResultStage
              key="result"
              resultUrl={resultUrl}
              onAgain={() => {
                setResultUrl(null);
                setStage("picker");
              }}
              onDone={() => onDone?.()}
            />
          )}
          {stage === "error" && (
            <ErrorStage
              key="error"
              message={errorMsg ?? "Something went wrong."}
              onRetry={() => setStage("picker")}
            />
          )}
        </AnimatePresence>
      </div>
    </BottomSheet>
  );
}

/* ============================================================ */
/*  Stages                                                       */
/* ============================================================ */

function PickerStage({
  designImageUrl,
  onUpload,
  onCapture,
}: {
  designImageUrl: string;
  onUpload: () => void;
  onCapture: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col gap-4"
    >
      {/* ─── Hero: design photo at its true aspect ratio ──────────────────── */}
      <div className="relative overflow-hidden rounded-card border border-hairline">
        <div className="relative w-full bg-mist-navy">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={designImageUrl}
            alt="Design to try on"
            className="mx-auto block max-h-[40vh] w-auto max-w-full object-contain"
          />
        </div>

        {/* Top-left AI badge (glass) */}
        <motion.div
          aria-hidden
          className="absolute left-3 top-3 flex items-center gap-1.5 rounded-pill border border-chalk-white/30 bg-chalk-white/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-chalk-white backdrop-blur-xl"
          initial={{ scale: 0.7, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.1, duration: 0.35 }}
        >
          <Sparkles size={13} />
          AI try-on
        </motion.div>

        {/* Shimmer sweep over the hero */}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "linear-gradient(110deg, transparent 30%, rgba(255,255,255,0.35) 50%, transparent 70%)",
            backgroundSize: "200% 100%",
          }}
          initial={{ backgroundPosition: "200% 0" }}
          animate={{ backgroundPosition: "-200% 0" }}
          transition={{ duration: 2.8, repeat: Infinity, ease: "linear" }}
        />
      </div>

      {/* ─── Glass "See it on you" section (its own card below the hero) ──── */}
      <div
        className="relative overflow-hidden rounded-card border border-chalk-white/25 p-4 shadow-[0_4px_24px_rgba(8,48,104,0.18)] backdrop-blur-xl"
        style={{
          background:
            "linear-gradient(135deg, var(--ink-navy) 0%, #0d3a78 60%, var(--ember) 140%)",
        }}
      >
        {/* Decorative glow */}
        <div
          aria-hidden
          className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full opacity-30 blur-2xl"
          style={{ background: "var(--tape-gradient)" }}
        />
        <div className="relative flex items-start gap-2.5">
          <motion.span
            aria-hidden
            animate={{ rotate: [0, 12, -12, 0], scale: [1, 1.15, 1] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
            className="mt-0.5 text-chalk-white drop-shadow"
          >
            <Sparkles size={20} />
          </motion.span>
          <div>
            <p
              className="font-heading text-h3 font-semibold drop-shadow-sm"
              style={{ color: "var(--draep-orange)" }}
            >
              {strings.tryOn.creativeTitle}
            </p>
            <p
              className="mt-1 text-caption leading-snug"
              style={{ color: "var(--ember)" }}
            >
              {strings.tryOn.creativeBody}
            </p>
          </div>
        </div>
      </div>

      {/* ─── How it works (3-step diagram) ───────────────────────────────── */}
      <HowItWorks />

      {/* ─── Two OS-native backed actions ────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2.5">
        <button
          type="button"
          onClick={onUpload}
          className="flex flex-col items-center justify-center gap-1.5 rounded-card border border-hairline-strong bg-chalk-white px-3 py-4 text-ink-navy transition-all hover:border-navy-interactive hover:shadow-card active:scale-[0.98]"
        >
          <Upload size={22} className="text-accent-text" />
          <span className="text-body font-medium">{strings.tryOn.uploadCta}</span>
        </button>
        <button
          type="button"
          onClick={onCapture}
          className="flex flex-col items-center justify-center gap-1.5 rounded-card border border-hairline-strong bg-chalk-white px-3 py-4 text-ink-navy transition-all hover:border-navy-interactive hover:shadow-card active:scale-[0.98]"
        >
          <CameraGlyph />
          <span className="text-body font-medium">{strings.tryOn.captureCta}</span>
        </button>
      </div>

      <p className="text-center text-caption text-muted">
        {strings.tryOn.photoTip}
      </p>
    </motion.div>
  );
}

/* ─── How-it-works diagram (Design → Photo → You) ────────────────────── */
function HowItWorks() {
  return (
    <div className="rounded-card border border-hairline bg-mist-navy/60 p-3">
      <p className="mb-2.5 font-mono text-eyebrow font-medium uppercase tracking-[0.18em] text-muted">
        {strings.tryOn.howHeading}
      </p>
      <div className="flex items-stretch gap-2">
        <Step
          index={1}
          title={strings.tryOn.step1Title}
        >
          {/* Hanger glyph */}
          <svg viewBox="0 0 32 32" className="h-6 w-6" fill="none" aria-hidden>
            <path
              d="M16 5a2.5 2.5 0 0 1 1.4 4.6L16 10.5V12l11 6.5a2 2 0 0 1-1 3.5H6a2 2 0 0 1-1-3.5L16 12"
              stroke="currentColor"
              strokeWidth={1.6}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="16" cy="5" r="1.4" fill="currentColor" />
          </svg>
        </Step>
        <Connector />
        <Step
          index={2}
          title={strings.tryOn.step2Title}
        >
          {/* Person-in-frame glyph */}
          <svg viewBox="0 0 32 32" className="h-6 w-6" fill="none" aria-hidden>
            <rect
              x="4"
              y="6"
              width="24"
              height="20"
              rx="2"
              stroke="currentColor"
              strokeWidth={1.6}
            />
            <circle cx="16" cy="14" r="3" stroke="currentColor" strokeWidth={1.6} />
            <path
              d="M10 24c1-3.5 3.2-5 6-5s5 1.5 6 5"
              stroke="currentColor"
              strokeWidth={1.6}
              strokeLinecap="round"
            />
          </svg>
        </Step>
        <Connector />
        <Step
          index={3}
          title={strings.tryOn.step3Title}
          highlight
        >
          <Sparkles size={22} />
        </Step>
      </div>
    </div>
  );
}

function Step({
  index,
  title,
  highlight,
  children,
}: {
  index: number;
  title: string;
  highlight?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center text-center">
      <div
        className={
          "mb-1.5 flex h-10 w-10 items-center justify-center rounded-full " +
          (highlight
            ? "text-chalk-white shadow-primary"
            : "bg-chalk-white text-accent-text border border-hairline-strong")
        }
        style={
          highlight ? { backgroundImage: "var(--tape-gradient)" } : undefined
        }
      >
        {children}
      </div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-navy">
        <span className="text-muted">{index}. </span>
        {title}
      </p>
    </div>
  );
}

function Connector() {
  return (
    <div className="flex items-center pt-2.5" aria-hidden>
      <svg width="14" height="10" viewBox="0 0 14 10" fill="none">
        <path
          d="M1 5h11M9 1.5L12.5 5 9 8.5"
          stroke="var(--tape-silver)"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

function CameraGlyph() {
  return (
    <svg
      width={22}
      height={22}
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

function LoadingStage() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      className="flex flex-col items-center gap-4 px-2 py-8"
    >
      {/* Branded AI loader — orbiting sparks around a pulsing core */}
      <div className="relative flex h-32 w-32 items-center justify-center">
        {/* Pulsing tape-gradient core */}
        <motion.div
          aria-hidden
          className="absolute inset-6 rounded-full opacity-90"
          style={{ backgroundImage: "var(--tape-gradient)" }}
          animate={{ scale: [1, 1.12, 1], opacity: [0.85, 1, 0.85] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
        />
        {/* Soft halo */}
        <motion.div
          aria-hidden
          className="absolute inset-0 rounded-full bg-draep-orange/30 blur-xl"
          animate={{ scale: [1, 1.2, 1], opacity: [0.4, 0.7, 0.4] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
        />
        {/* Orbiting sparks */}
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            aria-hidden
            className="absolute h-3 w-3 rounded-full bg-chalk-white shadow"
            style={{ offsetPath: "path('M 64 16 A 48 48 0 1 1 63.9 16 Z')" }}
            animate={{ offsetDistance: ["0%", "100%"] }}
            transition={{
              duration: 2.4,
              repeat: Infinity,
              ease: "linear",
              delay: i * 0.8,
            }}
          />
        ))}
        {/* Center sparkles */}
        <Sparkles size={26} className="relative z-10 text-chalk-white" />
      </div>

      <div className="text-center">
        <p className="font-heading text-h3 font-semibold text-ink-navy">
          {strings.tryOn.loadingTitle}
        </p>
        <p className="mt-1 text-caption text-muted">{strings.tryOn.loadingBody}</p>
      </div>

      {/* Indeterminate shimmer bar */}
      <div className="h-1 w-40 overflow-hidden rounded-pill bg-tape-silver">
        <motion.div
          className="h-full w-1/2 rounded-full"
          style={{ backgroundImage: "var(--tape-gradient)" }}
          animate={{ x: ["-100%", "200%"] }}
          transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>
    </motion.div>
  );
}

function ResultStage({
  resultUrl,
  onAgain,
  onDone,
}: {
  resultUrl: string;
  onAgain: () => void;
  onDone: () => void;
}) {
  const [fullscreen, setFullscreen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Briefly show a toast message.
  const showToast = useCallback((msg: string, ms = 2200) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), ms);
  }, []);

  // Download the image as a Blob (avoids weird cross-origin navigation issues).
  const fetchBlob = useCallback(async (): Promise<Blob | null> => {
    try {
      const res = await fetch(resultUrl);
      if (!res.ok) throw new Error("fetch failed");
      return await res.blob();
    } catch {
      return null;
    }
  }, [resultUrl]);

  // Save to device — anchors a Blob URL with a `download` attribute.
  const handleSave = useCallback(async () => {
    track({ event: "tryon_shared", design_image_url: resultUrl, share_method: "save" });
    const blob = await fetchBlob();
    if (!blob) {
      showToast(strings.tryOn.shareError);
      return;
    }
    const ext = blob.type.split("/")[1] || "jpg";
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objUrl;
    a.download = `draep-tryon.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objUrl);
    showToast(strings.tryOn.shareToast);
  }, [fetchBlob, resultUrl, showToast]);

  // Share to WhatsApp. Prefer the Web Share API with a file when supported
  // (covers mobile WA app); fall back to wa.me URL share.
  const handleWhatsapp = useCallback(async () => {
    track({ event: "tryon_shared", design_image_url: resultUrl, share_method: "whatsapp" });
    const nav = navigator as NavigatorWithShare;
    if (typeof nav.canShare === "function") {
      const blob = await fetchBlob();
      if (blob && nav.canShare({ files: [new File([blob], "draep-tryon.jpg", { type: blob.type })] })) {
        try {
          await nav.share({
            files: [new File([blob], "draep-tryon.jpg", { type: blob.type })],
            text: "My Draep try-on ✨",
          });
          return;
        } catch {
          /* fall through to wa.me */
        }
      }
    }
    window.open(
      `https://wa.me/?text=${encodeURIComponent("My Draep try-on ✨ " + resultUrl)}`,
      "_blank",
      "noopener,noreferrer",
    );
  }, [fetchBlob, resultUrl]);

  // Copy the result URL to clipboard.
  const handleCopy = useCallback(async () => {
    track({ event: "tryon_shared", design_image_url: resultUrl, share_method: "copy" });
    try {
      await navigator.clipboard.writeText(resultUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      showToast(strings.tryOn.shareError);
    }
  }, [resultUrl, showToast]);

  // Open the OS-native share sheet for any other app.
  const handleMore = useCallback(async () => {
    track({ event: "tryon_shared", design_image_url: resultUrl, share_method: "more" });
    const nav = navigator as NavigatorWithShare;
    if (typeof nav.share === "function") {
      try {
        const blob = await fetchBlob();
        const shareData: ShareData = {
          title: "My Draep try-on",
          text: "My Draep try-on ✨",
        };
        if (
          blob &&
          typeof nav.canShare === "function" &&
          nav.canShare({ files: [new File([blob], "draep-tryon.jpg", { type: blob.type })] })
        ) {
          shareData.files = [new File([blob], "draep-tryon.jpg", { type: blob.type })];
        } else {
          shareData.url = resultUrl;
        }
        await nav.share(shareData);
      } catch {
        /* user cancelled — silent */
      }
    } else {
      // No Web Share API — copy the URL as a fallback.
      void handleCopy();
    }
  }, [fetchBlob, resultUrl, handleCopy]);

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        className="relative flex flex-col gap-3"
      >
        {/* Result image — tap to open fullscreen */}
        <button
          type="button"
          onClick={() => setFullscreen(true)}
          className="group relative block w-full overflow-hidden rounded-card border border-hairline bg-mist-navy text-left"
          aria-label="Open image full screen"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <motion.img
            src={resultUrl}
            alt="Your virtual try-on"
            className="mx-auto block max-h-[50vh] w-auto max-w-full cursor-zoom-in object-contain transition-transform duration-200 group-hover:scale-[1.01]"
            initial={{ scale: 1.04, opacity: 0.4 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          />
          {/* AI preview badge (glass) */}
          <motion.div
            aria-hidden
            className="pointer-events-none absolute right-3 top-3 flex items-center gap-1 rounded-pill border border-chalk-white/30 bg-chalk-white/20 px-2.5 py-1 text-[11px] font-semibold text-chalk-white backdrop-blur-xl"
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.35, duration: 0.35 }}
          >
            <Sparkles size={12} />
            AI preview
          </motion.div>
          {/* Enlarge hint badge (bottom-left, always visible) */}
          <div className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-1 rounded-pill bg-ink-navy/70 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-chalk-white backdrop-blur-md">
            <ExpandGlyph />
            Tap to enlarge
          </div>
        </button>

        <div>
          <p className="font-heading text-h3 font-semibold text-ink-navy">
            {strings.tryOn.resultTitle}
          </p>
          <p className="mt-0.5 text-caption text-muted">{strings.tryOn.resultTip}</p>
        </div>

        {/* ─── Share row ──────────────────────────────────────────────────── */}
        <div className="rounded-card border border-hairline bg-mist-navy/60 p-2.5">
          <p className="mb-1.5 px-1 font-mono text-eyebrow font-medium uppercase tracking-[0.18em] text-muted">
            {strings.tryOn.shareHeading}
          </p>
          <div className="grid grid-cols-4 gap-1.5">
            <ShareButton label={strings.tryOn.shareSave} onClick={handleSave}>
              <DownloadGlyph />
            </ShareButton>
            <ShareButton label={strings.tryOn.shareWhatsapp} onClick={handleWhatsapp}>
              <WhatsappGlyph />
            </ShareButton>
            <ShareButton
              label={copied ? strings.tryOn.shareCopied : strings.tryOn.shareCopy}
              onClick={handleCopy}
              highlight={copied}
            >
              <LinkGlyph />
            </ShareButton>
            <ShareButton label={strings.tryOn.shareMore} onClick={handleMore}>
              <ShareGlyph />
            </ShareButton>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={onAgain}
            className="rounded-pill border border-hairline-strong bg-chalk-white px-3 py-1.5 text-caption font-medium text-ink-navy transition-all hover:border-navy-interactive active:scale-[0.98]"
          >
            {strings.tryOn.again}
          </button>
          <button
            type="button"
            onClick={onDone}
            className="rounded-pill bg-tape px-3 py-1.5 text-caption font-semibold text-chalk-white shadow-primary transition-all hover:brightness-105 active:scale-[0.98]"
            style={{ backgroundImage: "var(--tape-gradient)" }}
          >
            {strings.tryOn.done}
          </button>
        </div>

        {/* Toast */}
        <AnimatePresence>
          {toast && (
            <motion.div
              className="pointer-events-none absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded-pill bg-ink-navy/90 px-3 py-1.5 text-caption font-medium text-chalk-white shadow-card"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
            >
              {toast}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* ─── Fullscreen image overlay ──────────────────────────────────── */}
      <AnimatePresence>
        {fullscreen && (
          <motion.div
            className="fixed inset-0 z-[120] flex flex-col bg-ink-navy/95 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setFullscreen(false)}
          >
            {/* Top bar with close affordance */}
            <div className="flex items-center justify-between px-4 py-3">
              <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-chalk-white/80">
                <Sparkles size={13} />
                AI preview
              </span>
              <button
                type="button"
                onClick={() => setFullscreen(false)}
                aria-label="Close full screen"
                className="flex h-9 w-9 items-center justify-center rounded-full border border-chalk-white/25 bg-chalk-white/10 text-chalk-white transition-colors hover:bg-chalk-white/20"
              >
                <Close size={20} />
              </button>
            </div>
            {/* The image — fills available space, scrollable if needed */}
            <div className="flex flex-1 items-center justify-center overflow-auto p-3">
              <motion.img
                src={resultUrl}
                alt="Your virtual try-on (full screen)"
                className="block max-h-full max-w-full rounded-card object-contain"
                initial={{ scale: 0.96, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.96, opacity: 0 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
            <p className="pb-4 text-center text-caption text-chalk-white/60">
              Tap anywhere outside the image to close
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/* ─── Share button + glyphs ───────────────────────────────────────────── */

type NavigatorWithShare = Navigator & {
  canShare?: (data?: ShareData) => boolean;
};

function ShareButton({
  label,
  onClick,
  highlight,
  children,
}: {
  label: string;
  onClick: () => void;
  highlight?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "flex flex-col items-center justify-center gap-0.5 rounded-pill border px-1 py-1.5 text-[10px] font-medium transition-all active:scale-[0.97] " +
        (highlight
          ? "border-accent-text/50 bg-accent-fill/10 text-accent-text"
          : "border-hairline bg-chalk-white text-ink-navy hover:border-navy-interactive")
      }
    >
      <span className={highlight ? "text-accent-text" : "text-accent-text"}>
        {children}
      </span>
      <span className="leading-none">{label}</span>
    </button>
  );
}

function DownloadGlyph() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" />
    </svg>
  );
}

function LinkGlyph() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
      <path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
    </svg>
  );
}

function ShareGlyph() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="18" cy="5" r="2.5" />
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="19" r="2.5" />
      <path d="M8.2 10.7l7.6-4.4M8.2 13.3l7.6 4.4" />
    </svg>
  );
}

function WhatsappGlyph() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.86 9.86 0 0 0 12.04 2zm0 18a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.22 8.22 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.24-8.24 2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 0 1 2.41 5.83c0 4.54-3.7 8.23-8.23 8.23zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.17.24-.64.81-.79.97-.14.17-.29.19-.54.06-.25-.12-1.05-.39-1.99-1.23a7.45 7.45 0 0 1-1.38-1.71c-.14-.25-.01-.38.11-.5.11-.11.24-.29.37-.43.12-.14.16-.25.24-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.42-.56-.43-.14-.01-.31-.01-.48-.01s-.43.06-.66.31c-.23.24-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.68-1.18.21-.58.21-1.07.14-1.18-.06-.1-.22-.16-.47-.28z" />
    </svg>
  );
}

function ExpandGlyph() {
  return (
    <svg
      width={10}
      height={10}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {/* Four corner brackets — "expand" icon */}
      <path d="M1 4V1h3M11 4V1H8M1 8v3h3M11 8v3H8" />
    </svg>
  );
}

function ErrorStage({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.25 }}
      className="flex flex-col items-center gap-3 px-6 py-10 text-center"
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-error-bg text-error-text">
        <Close size={22} />
      </div>
      <p className="font-heading text-h3 font-semibold text-ink-navy">
        {strings.tryOn.errorTitle}
      </p>
      <p className="text-body text-muted">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-1 rounded-pill bg-tape px-5 py-2.5 text-body font-semibold text-chalk-white shadow-primary transition-all hover:brightness-105 active:scale-[0.98]"
        style={{ backgroundImage: "var(--tape-gradient)" }}
      >
        {strings.tryOn.errorRetry}
      </button>
    </motion.div>
  );
}
