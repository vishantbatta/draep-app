"use client";

import { useRef, useState } from "react";
import {
  resolveAssetUrl,
  uploadDesignImage,
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
    <div className="mb-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-medium uppercase tracking-wide text-muted">
          Design Inspiration ({items.length})
        </div>
        <div className="flex items-center gap-2">
          {uploading && (
            <span className="text-[10px] text-muted">Uploading…</span>
          )}
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
              <a
                href={src}
                target="_blank"
                rel="noopener noreferrer"
                title={`Open image ${i + 1} in new tab`}
                className="block overflow-hidden rounded-md border border-hairline-strong bg-mist-navy/20"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={src}
                  alt={`Design inspiration ${i + 1}`}
                  className="h-20 w-20 object-cover transition group-hover:opacity-90"
                  loading="lazy"
                />
              </a>
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

      {error && (
        <div className="mt-1 text-[10px] text-red-600">{error}</div>
      )}
      {items.length > 0 && (
        <div className="mt-0.5 text-[10px] text-muted">
          Click a thumbnail to open full-size.
        </div>
      )}
    </div>
  );
}
