"use client";

/**
 * Local-stash photo capture gate (core/item_images) — shared by every
 * configurator that holds selections in client state before item rows
 * exist (customer /create wizard, admin GarmentSelectionSheet draft +
 * persist modes).
 *
 * Opens the moment a photo-required option is picked. Photos are held
 * locally (Object-URL previews) until the host attaches them to the created
 * item rows. The only way out WITH the pick applied is the "Use this option"
 * CTA, enabled once the stash meets min — closing any other way cancels the
 * pick, so the requirement can never be skipped by backing out.
 */

import { useEffect, useRef, useState } from "react";

import { BottomSheet } from "@/components/ui/BottomSheet";
import { Plus } from "@/components/ui/icons";

/** Hard cap when the catalog sets no max (mirrors the backend ceiling). */
export const PHOTO_STASH_MAX = 12;

export const PHOTO_ACCEPT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/avif",
];
export const MAX_PHOTO_BYTES = 12 * 1024 * 1024;

export interface StashedPhoto {
  file: File;
  /** Object URL for preview — revoked when the stash is cleared/dropped. */
  url: string;
}

/** What the photos are for + the requirement that opened the gate. */
export interface PhotoGateRequest {
  min: number;
  max: number | null;
  note: string | null;
  title: string;
  /** Stash slot this requirement's photos belong to. */
  key: string;
}

/** Drop files that are neither an accepted image type nor within the size
 *  cap, and wrap the rest into stash entries. */
export function toStashedPhotos(files: File[]): StashedPhoto[] {
  return files
    .filter(
      (f) =>
        PHOTO_ACCEPT_TYPES.includes(f.type) && f.size <= MAX_PHOTO_BYTES,
    )
    .map((file) => ({ file, url: URL.createObjectURL(file) }));
}

// ─── Stash keys ──────────────────────────────────────────────────────────────
// Must agree between the picker that stashes (pre-row) and the saver that
// attaches (post-row). Key = one garment_orders_item's identity.

export function compStashKey(
  componentId: string,
  variationId: string,
  typeId?: string | null,
): string {
  return `comp:${componentId}:${variationId}:${typeId ?? ""}`;
}

export function addonStashKey(
  addonId: string,
  avId?: string | null,
  placement?: string | null,
): string {
  return `addon:${addonId}:${avId ?? ""}:${placement ?? ""}`;
}

interface StashKeyRow {
  type: string | null; // "variation" | "selection" | "add_on"
  garment_style_component_id?: string | null;
  variation_id?: string | null;
  variation_type_id?: string | null;
  addon_id?: string | null;
  addon_variation_id?: string | null;
  placement?: string | string[] | null;
}

/** Stash key for a created/updated item row (row shapes differ slightly
 *  across hosts — generic-table rows, customer detail items, draft items —
 *  the field set above is the common denominator). */
export function stashKeyForRow(row: StashKeyRow): string {
  if (row.type === "add_on") {
    const p = Array.isArray(row.placement)
      ? (row.placement[0] ?? null)
      : (row.placement ?? null);
    return addonStashKey(row.addon_id ?? "", row.addon_variation_id, p);
  }
  return compStashKey(
    row.garment_style_component_id ?? "",
    row.variation_id ?? "",
    row.variation_type_id,
  );
}

// ─── Sheet ───────────────────────────────────────────────────────────────────

export function PhotoGateSheet({
  req,
  photos,
  onAdd,
  onRemove,
  onCancel,
  onUse,
}: {
  req: PhotoGateRequest;
  photos: StashedPhoto[];
  onAdd: (files: File[]) => void;
  onRemove: (url: string) => void;
  onCancel: () => void;
  /** Applies the gated pick — only reachable when photos.length >= min. */
  onUse: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const cap = Math.min(req.max ?? PHOTO_STASH_MAX, PHOTO_STASH_MAX);
  const have = photos.length;
  const satisfied = have >= req.min;
  const [dragOver, setDragOver] = useState(false);

  /** Paste a screenshot (Cmd+V) — works even where the OS file picker is
   *  unavailable (embedded webviews). */
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length) onAdd(files);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [onAdd]);

  return (
    <BottomSheet
      open
      onClose={onCancel}
      title={`Photos needed — ${req.title}`}
      footer={
        <div className="flex flex-col gap-2">
          {/* Primary CTA is ALWAYS active: below the minimum it opens the
              camera/file picker (the most inviting target must never be a
              dead disabled button); once satisfied it applies the pick. */}
          <button
            type="button"
            onClick={() =>
              satisfied ? onUse() : inputRef.current?.click()
            }
            className="w-full rounded-pill bg-ink-navy py-3 text-body font-semibold text-chalk-white transition-all ease-brand active:scale-[0.99]"
          >
            {satisfied
              ? "Use this option"
              : `＋ Add ${req.min - have} more photo${req.min - have !== 1 ? "s" : ""}`}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="w-full rounded-pill border border-hairline-strong py-2.5 text-caption font-medium text-ink-navy"
          >
            Choose a different option
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-caption leading-snug text-ink/80">
          This option needs {req.min} reference photo{req.min !== 1 ? "s" : ""}
          {cap > req.min ? ` (up to ${cap})` : ""} — they go to the tailor with
          the order.
        </p>
        {req.note && (
          <p className="rounded-card bg-amber-50 px-3 py-2 text-caption text-amber-900 ring-1 ring-amber-200">
            📷 {req.note}
          </p>
        )}

        <div
          className={
            "grid grid-cols-3 gap-2 " +
            (dragOver ? "rounded-card ring-2 ring-accent-text " : "")
          }
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const files = Array.from(e.dataTransfer?.files ?? []);
            if (files.length) onAdd(files);
          }}
        >
          {photos.map((p) => (
            <div key={p.url} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.url}
                alt=""
                className="h-24 w-full rounded-card object-cover ring-1 ring-hairline"
              />
              <button
                type="button"
                onClick={() => onRemove(p.url)}
                className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-[11px] text-chalk-white"
                aria-label="Remove photo"
              >
                ✕
              </button>
            </div>
          ))}
          {have < cap && (
            /* No onClick here on purpose: the invisible input below overlays
               the tile and receives the tap natively. A handler that calls
               input.click() would fire a SECOND dialog after the tap's click
               bubbles up — the picker "reopening" and eating the first
               selection. */
            <button
              type="button"
              className="relative flex h-24 w-full flex-col items-center justify-center gap-1 rounded-card border-2 border-dashed border-hairline-strong text-muted"
            >
              <Plus size={20} />
              <span className="text-[10px] font-medium">
                Add photo · {have}/{cap}
              </span>
              {/* The input itself overlays the tile (rendered, not
                  display:none) so the native tap reaches it directly —
                  WebKit restricts .click() on hidden file inputs, and some
                  embedded webviews only allow pickers for rendered inputs. */}
              <input
                ref={inputRef}
                type="file"
                accept={PHOTO_ACCEPT_TYPES.join(",")}
                multiple
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length) onAdd(files);
                  e.target.value = "";
                }}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              />
            </button>
          )}
        </div>

      </div>
    </BottomSheet>
  );
}
