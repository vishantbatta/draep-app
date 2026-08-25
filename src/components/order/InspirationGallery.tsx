"use client";

import { useEffect, useRef, useState } from "react";
import { ordersApi } from "@/lib/api";
import { strings } from "@/lib/strings";
import { Plus } from "@/components/ui/icons";

// Mirrors the backend upload cap (12 MB) and the browser-decodable set.
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

/** Returns an error message, or null when the file is acceptable. */
function validateImage(file: File): string | null {
  if (!file.type.startsWith("image/")) {
    return "not an image file";
  }
  // HEIC/HEIF/AVIF can't be decoded by browsers in an <img> tag, so the
  // thumbnail would render broken. Reject up front with guidance.
  const name = file.name.toLowerCase();
  if (
    file.type === "image/heic" ||
    file.type === "image/heif" ||
    file.type === "image/avif" ||
    name.endsWith(".heic") ||
    name.endsWith(".heif") ||
    name.endsWith(".avif")
  ) {
    return "HEIC/AVIF can't be previewed — convert to JPG, PNG or WebP";
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return "image is over 12 MB";
  }
  return null;
}

/** Stored URLs are same-origin relative paths (/uploads, /designs/ai); older
 * rows may hold absolute backend URLs — rewrite those to the pathname so the
 * request rides the Next.js proxy instead of hitting the backend cross-origin. */
function assetSrc(url: string): string {
  if (url.startsWith("/")) return url;
  try {
    const u = new URL(url);
    if (u.pathname.startsWith("/uploads/") || u.pathname.startsWith("/designs/")) {
      return u.pathname;
    }
  } catch {
    // not a valid absolute URL — fall through
  }
  return url;
}

/**
 * "Design inspiration" gallery for one garment order — the images (MYOD
 * renders + the customer's own uploads) the tailor receives with the design.
 * Owns its upload flow (multipart → customer inspiration endpoint) and tells
 * the parent to refetch; view-only when editable is false (paid orders are
 * locked).
 */
export function InspirationGallery({
  orderId,
  garmentOrderId,
  assets,
  editable,
  onUploaded,
}: {
  orderId: string;
  garmentOrderId: string;
  assets: string[];
  editable: boolean;
  onUploaded: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{ src: string; index: number } | null>(
    null,
  );

  const items = assets.filter((u): u is string => typeof u === "string");

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const failures: string[] = [];
    const valid: File[] = [];
    for (const file of Array.from(files)) {
      const err = validateImage(file);
      if (err) failures.push(`${file.name}: ${err}`);
      else valid.push(file);
    }
    if (valid.length > 0) {
      setUploading(true);
      setError(null);
      try {
        await ordersApi.uploadInspiration(orderId, garmentOrderId, valid);
        onUploaded();
      } catch (e) {
        failures.push(
          e instanceof Error && e.message
            ? e.message
            : strings.orderDetail.inspirationError,
        );
      } finally {
        setUploading(false);
      }
    }
    if (failures.length > 0) setError(failures.join(" · "));
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

  return (
    <div className="mt-4">
      <p className="text-eyebrow uppercase tracking-wider text-accent-text">
        {strings.orderDetail.inspirationTitle}
        {items.length > 0 ? ` (${items.length})` : ""}
      </p>
      <p className="mt-1 text-[11px] leading-snug text-muted">
        {strings.orderDetail.inspirationTailorNote}
      </p>

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

      <div className="mt-2 grid grid-cols-4 gap-2">
        {items.map((raw, i) => (
          <button
            key={`${raw}-${i}`}
            type="button"
            onClick={() => setLightbox({ src: assetSrc(raw), index: i })}
            aria-label={`View inspiration photo ${i + 1}`}
            className="overflow-hidden rounded-card border border-hairline bg-mist-navy/20 transition ease-brand active:scale-[0.97]"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={assetSrc(raw)}
              alt={`Design inspiration ${i + 1}`}
              className="aspect-square w-full object-contain"
              loading="lazy"
            />
          </button>
        ))}

        {uploading && (
          <div className="flex aspect-square items-center justify-center rounded-card border border-hairline bg-mist-navy/20">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-ink-navy border-t-transparent" />
          </div>
        )}

        {editable && !uploading && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            aria-label={strings.orderDetail.inspirationAddCta}
            className="flex aspect-square flex-col items-center justify-center gap-1 rounded-card border border-dashed border-hairline-strong text-muted transition ease-brand active:scale-[0.97] active:bg-mist-navy"
          >
            <Plus size={16} />
            <span className="text-[10px] font-medium leading-none">
              {strings.orderDetail.inspirationAddCta}
            </span>
          </button>
        )}
      </div>

      {items.length === 0 && !editable && !uploading && (
        <p className="mt-2 text-[11px] text-muted">
          {strings.orderDetail.inspirationEmpty}
        </p>
      )}

      {uploading && (
        <p className="mt-1 text-[10px] text-muted">
          {strings.orderDetail.inspirationUploading}
        </p>
      )}
      {error && (
        <p className="mt-1 text-[11px] text-error-text">{error}</p>
      )}

      {/* Fullscreen viewer — closes on backdrop tap / ✕ / Escape */}
      {lightbox && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Design inspiration ${lightbox.index + 1}, full size`}
          onClick={() => setLightbox(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink-navy/90 p-4 backdrop-blur-sm"
        >
          <button
            type="button"
            onClick={() => setLightbox(null)}
            aria-label="Close fullscreen image"
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-chalk-white/10 text-chalk-white transition ease-brand active:scale-95 active:bg-chalk-white/25"
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
            className="max-h-full max-w-full select-none rounded-card object-contain shadow-2xl"
          />
        </div>
      )}
    </div>
  );
}
