"use client";

/**
 * Item reference photos (core/item_images) — shared UI pieces.
 *
 * The catalog defines a min/max photo requirement on variations, variation
 * types, add-ons and add-on variations. When such an option lands on a
 * garment order, whoever added it (customer / captain / admin) is asked to
 * upload photos, which live on the garment_orders_item row itself and ride
 * along to the tailor.
 *
 * Exports:
 *  - ItemImagesBadge  — the "N photos needed / ✓" chip rendered per item row
 *  - ItemImagesSheet  — the capture sheet (upload / view / delete one photo)
 *  - itemImagesState  — tiny helper: effective requirement for a leaf +
 *                       parent catalog pair (mirrors the BE precedence:
 *                       leaf overrides parent when it defines ANY of the
 *                       three columns).
 */

import { useEffect, useRef, useState } from "react";

import { BottomSheet } from "@/components/ui/BottomSheet";
import { Loader } from "@/components/ui/Loader";

// ─── requirement resolution (mirror of be/app/core/item_images.py) ───────────

export interface RequirementSource {
  min_images?: number | null;
  max_images?: number | null;
  image_note?: Record<string, string> | null;
}

export interface ItemImagesState {
  required: boolean;
  minImages: number;
  maxImages: number | null;
  note: string | null;
  have: number;
  pending: boolean;
}

/** Leaf (variation type / add-on variation) overrides parent (variation /
 *  add-on) when it defines any of the three columns — same rule as the BE. */
export function itemImagesState(
  leaf: RequirementSource | null | undefined,
  parent: RequirementSource | null | undefined,
  images: string[] | null | undefined,
): ItemImagesState {
  const defines = (s: RequirementSource | null | undefined) =>
    !!s &&
    (s.min_images != null || s.max_images != null || s.image_note != null);
  const src = defines(leaf) ? leaf : parent;
  const min = src?.min_images ?? 0;
  const max = src?.max_images ?? null;
  const have = Array.isArray(images) ? images.length : 0;
  return {
    required: min >= 1,
    minImages: min,
    maxImages: max,
    note: src?.image_note?.en ?? null,
    have,
    pending: min >= 1 && have < min,
  };
}

/** Normalize a stored upload URL to a same-origin path the Next proxy serves. */
export function itemImageSrc(url: string): string {
  if (url.startsWith("/")) return url;
  try {
    const u = new URL(url);
    if (u.pathname.startsWith("/uploads/")) return u.pathname;
  } catch {
    // not a valid absolute URL — fall through
  }
  return url;
}

export function filenameOf(url: string): string {
  return url.split("/").pop() ?? url;
}

// ─── badge ───────────────────────────────────────────────────────────────────

export function ItemImagesBadge({
  state,
  onClick,
}: {
  state: ItemImagesState;
  onClick?: () => void;
}) {
  if (!state.required) return null;
  const done = !state.pending;
  const label = done
    ? `${state.have} photo${state.have !== 1 ? "s" : ""} ✓`
    : `${state.minImages - state.have} photo${
        state.minImages - state.have !== 1 ? "s" : ""
      } needed`;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
        done
          ? "bg-green-100 text-green-700"
          : "bg-amber-100 text-amber-800 ring-1 ring-amber-300"
      } ${onClick ? "cursor-pointer" : "cursor-default"}`}
    >
      <span aria-hidden>{done ? "📷" : "⚠️"}</span> {label}
    </button>
  );
}

// ─── capture sheet ───────────────────────────────────────────────────────────

export function ItemImagesSheet({
  open,
  onClose,
  title,
  state,
  images,
  upload,
  remove,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  /** What the photos are for, e.g. "Boat neck". */
  title: string;
  state: ItemImagesState;
  images: string[];
  /** Upload the chosen files; should throw with a user-readable message. */
  upload: (files: File[]) => Promise<unknown>;
  /** Remove one stored photo by its bare filename. */
  remove: (filename: string) => Promise<unknown>;
  /** Called after a successful upload/remove so the parent refetches. */
  onChanged: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  /** Paste a screenshot (Cmd+V) — works even where the OS file picker is
   *  unavailable (embedded webviews). */
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length) void handleFiles(files);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images.length]);

  const cap = state.maxImages ?? 12;
  const canAdd = images.length < cap;

  async function handleFiles(fileList: FileList | File[] | null) {
    const files = Array.from(fileList ?? []);
    if (files.length === 0) return;
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    if (images.length + list.length > cap) {
      setError(
        `This option accepts at most ${cap} photo${
          cap !== 1 ? "s" : ""
        } (${images.length} already uploaded).`,
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await upload(list);
      onChanged();
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleRemove(filename: string) {
    setBusy(true);
    setError(null);
    try {
      await remove(filename);
      onChanged();
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Remove failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <BottomSheet
        open={open}
        onClose={onClose}
        title={`Photos — ${title}`}
        footer={
          canAdd ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
              className="w-full rounded-xl bg-neutral-900 py-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy ? "Uploading…" : `Add photos (${images.length}/${cap})`}
            </button>
          ) : (
            <p className="w-full text-center text-xs text-neutral-500">
              Photo limit reached ({cap}).
            </p>
          )
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-neutral-600">
            {state.required
              ? state.pending
                ? `This choice needs ${state.minImages} photo${
                    state.minImages !== 1 ? "s" : ""
                  } before you can pay.`
                : `Requirement met (${state.minImages} needed, ${state.have} uploaded).`
              : "Reference photos for this choice."}
            {state.maxImages != null &&
              ` Up to ${state.maxImages} allowed.`}
          </p>
          {state.note && (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">
              📷 {state.note}
            </p>
          )}
          {error && (
            <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700 ring-1 ring-red-200">
              {error}
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
              if (files.length) void handleFiles(files);
            }}
          >
            {images.map((url) => (
              <div key={url} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={itemImageSrc(url)}
                  alt=""
                  className="h-24 w-full cursor-zoom-in rounded-lg object-cover ring-1 ring-neutral-200"
                  onClick={() => setLightbox(url)}
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleRemove(filenameOf(url))}
                  className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-xs text-white"
                  aria-label="Remove photo"
                >
                  ✕
                </button>
              </div>
            ))}
            {canAdd && (
              /* No onClick — the overlay input takes the tap natively; a
                 click handler here would open a second file dialog. */
              <button
                type="button"
                disabled={busy}
                className="relative flex h-24 w-full flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-neutral-300 text-neutral-500"
              >
                {busy ? <Loader /> : <span className="text-xl">＋</span>}
                <span className="text-[10px]">Add photo</span>
                {/* Rendered (not display:none) overlay — the native tap
                    reaches the input directly; WebKit restricts .click()
                    on hidden file inputs. */}
                <input
                  ref={inputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/avif"
                  multiple
                  onChange={(e) => handleFiles(e.target.files)}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                />
              </button>
            )}
          </div>

        </div>
      </BottomSheet>

      {lightbox && (
        <button
          type="button"
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightbox(null)}
          aria-label="Close photo"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={itemImageSrc(lightbox)}
            alt=""
            className="max-h-full max-w-full rounded-lg object-contain"
          />
        </button>
      )}
    </>
  );
}
