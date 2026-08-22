"use client";

import { useEffect, useRef, useState } from "react";
import { BottomSheet } from "@/components/ui/BottomSheet";
import {
  aiGenerateInspiration,
  resolveAssetUrl,
  uploadDesignImage,
  type AiImageResult,
  type GarmentOrderRow,
} from "@/lib/admin-api";

// Mirrors the /admin/design-ai/upload cap (12 MB).
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

/** Returns an error message, or null when the file is acceptable. */
function validateImage(file: File): string | null {
  if (!file.type.startsWith("image/")) {
    return "not an image file (JPG, PNG, WebP only)";
  }
  // HEIC/HEIF/AVIF can't be decoded by browsers in an <img> tag, so the
  // thumbnail would render broken. Reject up front with guidance.
  const name = file.name.toLowerCase();
  const undecodable =
    file.type === "image/heic" ||
    file.type === "image/heif" ||
    file.type === "image/avif" ||
    name.endsWith(".heic") ||
    name.endsWith(".heif") ||
    name.endsWith(".avif");
  if (undecodable) {
    return "HEIC/AVIF can't be previewed — convert to JPG, PNG or WebP";
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return "image is over 12 MB";
  }
  return null;
}

/**
 * Editable "Design Inspiration" gallery for one garment order.
 *
 * Uploads go through uploadDesignImage() (admin image host); the returned
 * URLs are appended to garment_orders.assets_shared via onAttach, so the
 * write happens once per batch. onDetach removes a single stored URL.
 */
export function GarmentOrderAssets({
  go,
  onAttach,
  onDetach,
}: {
  go: GarmentOrderRow;
  onAttach: (goId: string, urls: string[]) => Promise<void>;
  onDetach: (goId: string, url: string) => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [removingUrl, setRemovingUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{ src: string; index: number } | null>(
    null,
  );
  // Hover arms this gallery as the paste target — the order page renders one
  // gallery per garment order, so the pointer picks which garment a pasted
  // screenshot belongs to.
  const [hovered, setHovered] = useState(false);

  // ── AI-generated inspiration ────────────────────────────────────────────
  // The whole flow (first render → preview → regenerate with comment) lives
  // in a bottom sheet; the button in the gallery header opens it. One render
  // per call: the backend builds the prompt from this GO's saved selections
  // (+ the comment as extra direction on Regenerate) and returns the image
  // URL. Nothing touches assets_shared until "Save".
  const [aiOpen, setAiOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiSaving, setAiSaving] = useState(false);
  const [aiPreview, setAiPreview] = useState<AiImageResult | null>(null);
  const [aiComment, setAiComment] = useState("");
  const [aiError, setAiError] = useState<string | null>(null);

  function openAiSheet() {
    setAiOpen(true);
    // First open kicks off the render; reopens (with a preview already in
    // hand, or one still in flight) just show it instead of burning a call.
    if (!aiPreview && !aiBusy) void generateAi();
  }

  function closeAiSheet() {
    // Block dismissal mid-save — the attach is in flight and its result
    // (gallery update) should land before the sheet goes away.
    if (aiSaving) return;
    setAiOpen(false);
  }

  async function generateAi() {
    if (aiBusy) return;
    setAiBusy(true);
    setAiError(null);
    try {
      const res = await aiGenerateInspiration({
        garment_order_id: go.id,
        comment: aiComment.trim() || null,
      });
      setAiPreview(res);
    } catch (e) {
      setAiError(
        e instanceof Error ? e.message : "AI generation failed. Try again.",
      );
    } finally {
      setAiBusy(false);
    }
  }

  async function saveAi() {
    if (!aiPreview || aiSaving) return;
    setAiSaving(true);
    setAiError(null);
    try {
      await onAttach(go.id, [aiPreview.url]);
      setAiPreview(null);
      setAiComment("");
      setAiOpen(false);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setAiSaving(false);
    }
  }

  // While the fullscreen viewer is open: close on Escape and lock page scroll.
  useEffect(() => {
    if (!lightbox) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setLightbox(null);
    }
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [lightbox]);

  // Paste-to-upload while hovering: screenshots arrive on the clipboard as
  // image files and flow through the same validation + upload path as picked
  // files. Text pastes are left alone for the browser to handle.
  useEffect(() => {
    if (!hovered) return;
    function onPaste(e: ClipboardEvent) {
      const files = e.clipboardData?.files;
      if (!files || files.length === 0) return;
      const hasImage = Array.from(files).some((f) =>
        f.type.startsWith("image/"),
      );
      if (!hasImage) return;
      e.preventDefault();
      void handleFiles(files);
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  // Keep raw (stored) URLs for onDetach — resolveAssetUrl rewrites absolute
  // backend URLs to same-origin ones, which would no longer match the row.
  const items = (Array.isArray(go.assets_shared) ? go.assets_shared : [])
    .filter((u): u is string => typeof u === "string")
    .map((raw) => ({ raw, src: resolveAssetUrl(raw) }))
    .filter((it): it is { raw: string; src: string } => it.src !== null);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const failures: string[] = [];
    const valid: File[] = [];
    for (const file of Array.from(files)) {
      const err = validateImage(file);
      if (err) failures.push(`${file.name}: ${err}`);
      else valid.push(file);
    }

    const uploaded: string[] = [];
    if (valid.length > 0) {
      setUploading(true);
      setError(null);
      try {
        for (const file of valid) {
          try {
            uploaded.push(await uploadDesignImage(file));
          } catch (e) {
            failures.push(
              `${file.name}: ${e instanceof Error ? e.message : "upload failed"}`,
            );
          }
        }
        if (uploaded.length > 0) await onAttach(go.id, uploaded);
      } finally {
        setUploading(false);
      }
    }
    if (failures.length > 0) setError(failures.join(" · "));
  }

  async function handleRemove(url: string) {
    setRemovingUrl(url);
    setError(null);
    try {
      await onDetach(go.id, url);
    } finally {
      setRemovingUrl(null);
    }
  }

  return (
    <div
      className="mb-3"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-medium uppercase tracking-wide text-muted">
          Design Inspiration ({items.length})
        </div>
        <div className="flex items-center gap-2">
          {hovered && (
            <span
              className="text-[10px] text-muted"
              suppressHydrationWarning
            >
              {typeof navigator !== "undefined" &&
              /Mac|iP/.test(navigator.platform)
                ? "⌘V to paste"
                : "Ctrl+V to paste"}
            </span>
          )}
          {uploading && (
            <span className="text-[10px] text-muted">Uploading…</span>
          )}
          <button
            onClick={openAiSheet}
            title="Generate a design inspiration image from this garment's saved selections"
            className="flex items-center gap-1 rounded-md border border-accent-text/40 bg-chalk-white px-2 py-1 text-xs font-medium text-accent-text transition hover:bg-mist-navy/40 disabled:cursor-wait disabled:opacity-60"
          >
            {aiBusy ? (
              <>
                <svg
                  className="h-3 w-3 animate-spin"
                  viewBox="0 0 16 16"
                  fill="none"
                >
                  <circle
                    cx="8"
                    cy="8"
                    r="6.5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeDasharray="10 30"
                  />
                  <path
                    d="M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
                Generating…
              </>
            ) : (
              "✦ Generate using AI"
            )}
          </button>
          <button
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="rounded-md border border-hairline-strong bg-chalk-white px-2 py-1 text-xs font-medium text-ink-navy hover:border-ink-navy disabled:opacity-50"
          >
            + Add Images
          </button>
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          void handleFiles(e.target.files);
          e.target.value = ""; // reset so the same file can be re-selected
        }}
      />

      {items.length > 0 ? (
        <div className="mt-1 flex flex-wrap gap-2">
          {items.map(({ raw, src }, i) => (
            <div key={`${raw}-${i}`} className="group relative">
              <button
                type="button"
                onClick={() => setLightbox({ src, index: i })}
                title={`View image ${i + 1} full-size`}
                aria-label={`View image ${i + 1} full-size`}
                className="block cursor-zoom-in overflow-hidden rounded-md border border-hairline-strong bg-mist-navy/20"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={src}
                  alt={`Design inspiration ${i + 1}`}
                  className="h-20 w-20 object-contain transition group-hover:opacity-90"
                  loading="lazy"
                />
              </button>
              <button
                onClick={() => void handleRemove(raw)}
                disabled={removingUrl === raw || uploading}
                title={
                  removingUrl === raw ? "Removing…" : "Remove this image"
                }
                aria-label={`Remove image ${i + 1}`}
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-hairline-strong bg-chalk-white text-xs leading-none text-muted opacity-70 transition hover:border-red-300 hover:text-red-600 group-hover:opacity-100 disabled:opacity-50"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-1 text-[10px] text-muted">
          No design inspiration yet — add reference images for this garment.
        </div>
      )}

      {/* AI generation bottom sheet — skeleton → preview → Regenerate | Save.
          Nothing is written to assets_shared until "Save inspiration". */}
      <BottomSheet
        open={aiOpen}
        onClose={closeAiSheet}
        title="AI Design Inspiration"
        footer={
          <div className="flex items-center justify-between gap-3">
            <span className="text-[10px] text-muted">
              {aiPreview
                ? aiBusy
                  ? "Regenerating with your comment…"
                  : "Not saved yet — Save adds it to this garment's inspiration."
                : "Rendering from this garment's saved selections…"}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => void generateAi()}
                disabled={!aiPreview || aiBusy || aiSaving}
                className="rounded-lg border border-hairline-strong bg-chalk-white px-4 py-2 text-xs font-medium text-ink-navy transition hover:border-ink-navy disabled:cursor-not-allowed disabled:opacity-40"
              >
                {aiBusy ? "Regenerating…" : "↻ Regenerate"}
              </button>
              <button
                onClick={() => void saveAi()}
                disabled={!aiPreview || aiBusy || aiSaving}
                className="rounded-lg bg-tape px-4 py-2 text-xs font-semibold text-chalk-white shadow-primary transition hover:bg-tape/90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {aiSaving ? "Saving…" : "Save inspiration"}
              </button>
            </div>
          </div>
        }
      >
        {aiError && (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700">
            <div className="font-medium">Generation failed</div>
            <div className="mt-0.5">{aiError}</div>
            <button
              onClick={() => void generateAi()}
              disabled={aiBusy}
              className="mt-2 rounded-md border border-red-300 bg-white px-3 py-1.5 text-[11px] font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-50"
            >
              Try again
            </button>
          </div>
        )}

        {/* First render — skeleton while no image exists yet */}
        {!aiPreview && (
          <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-hairline-strong bg-mist-navy/20">
            <svg
              className="h-7 w-7 animate-spin text-accent-text"
              viewBox="0 0 16 16"
              fill="none"
            >
              <circle
                cx="8"
                cy="8"
                r="6.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeDasharray="10 30"
              />
              <path
                d="M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            <div className="text-center text-xs text-muted">
              Painting the design from this garment&apos;s selections…
              <div className="mt-0.5 text-[10px] opacity-70">
                ~15-30s · every selection is included in the prompt
              </div>
            </div>
          </div>
        )}

        {/* Preview — image, direction input, prompt */}
        {aiPreview && (
          <div className="space-y-3 pb-2">
            <div className="relative mx-auto w-fit">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={resolveAssetUrl(aiPreview.url) ?? aiPreview.url}
                alt="AI-generated design inspiration preview"
                className="mx-auto max-h-[46dvh] rounded-xl border border-hairline-strong bg-chalk-white object-contain shadow-primary"
              />
              {aiBusy && (
                <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-chalk-white/70">
                  <svg
                    className="h-7 w-7 animate-spin text-accent-text"
                    viewBox="0 0 16 16"
                    fill="none"
                  >
                    <circle
                      cx="8"
                      cy="8"
                      r="6.5"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeDasharray="10 30"
                    />
                    <path
                      d="M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                  </svg>
                </div>
              )}
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted">
                What should change?
              </label>
              <input
                type="text"
                value={aiComment}
                onChange={(e) => setAiComment(e.target.value)}
                placeholder="e.g. darker fabric, deeper neckline, gold piping…"
                aria-label="Regeneration direction"
                className="w-full rounded-lg border border-hairline-strong bg-chalk-white px-3 py-2 text-sm text-ink focus:border-ink-navy focus:outline-none"
              />
            </div>
            <details>
              <summary className="cursor-pointer font-mono text-[10px] text-muted">
                Prompt used
              </summary>
              <p className="mt-1 max-h-36 overflow-y-auto whitespace-pre-wrap rounded-md border border-hairline bg-chalk-white px-2 py-1.5 text-[10px] leading-relaxed text-ink">
                {aiPreview.prompt}
              </p>
            </details>
          </div>
        )}
      </BottomSheet>

      {error && (
        <div className="mt-1 text-[10px] text-red-600">{error}</div>
      )}
      {items.length > 0 && (
        <div className="mt-0.5 text-[10px] text-muted">
          Click a thumbnail to view full-size.
        </div>
      )}

      {/* Fullscreen viewer — same page, closes on ✕ / backdrop / Escape */}
      {lightbox && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Design inspiration ${lightbox.index + 1}, full size`}
          onClick={() => setLightbox(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink-navy/90 p-4 backdrop-blur-sm sm:p-10"
        >
          <button
            type="button"
            onClick={() => setLightbox(null)}
            aria-label="Close fullscreen image"
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-chalk-white/10 text-chalk-white transition hover:bg-chalk-white/25"
          >
            <svg className="h-5 w-5" viewBox="0 0 16 16" fill="none">
              <path
                d="M3 3l10 10M13 3L3 13"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <div className="absolute left-4 top-5 rounded-full bg-chalk-white/10 px-3 py-1 text-xs font-medium text-chalk-white">
            {lightbox.index + 1} / {items.length}
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightbox.src}
            alt={`Design inspiration ${lightbox.index + 1}, full size`}
            onClick={(e) => e.stopPropagation()}
            className="max-h-full max-w-full select-none rounded-lg object-contain shadow-2xl"
          />
        </div>
      )}
    </div>
  );
}
