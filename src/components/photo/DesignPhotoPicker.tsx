"use client";

/**
 * DesignPhotoPicker — step 1 of "Share a design with us".
 *
 * Collects up to `max` photos of the garment the customer wants copied:
 * the OS picker (`multiple`) and an in-page rear-camera viewfinder
 * (CameraStage, shared with try-on) both feed one list. Thumbnails can be
 * removed; the primary CTA hands the files to the host for upload + analysis.
 * Pure presentation — the host owns the `files` array.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import { CameraGlyph, CameraStage } from "@/components/photo/CameraStage";
import { Button } from "@/components/ui/Button";
import { Close, Upload } from "@/components/ui/icons";
import { withImageExtension } from "@/lib/auto-design";
import { strings } from "@/lib/strings";

export const DESIGN_PHOTO_MAX = 6;

export function DesignPhotoPicker({
  files,
  onChange,
  onAnalyze,
  busy = false,
  busyLabel,
  error,
  max = DESIGN_PHOTO_MAX,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  onAnalyze: () => void;
  /** Upload in flight — CTA shows a spinner, inputs are disabled. */
  busy?: boolean;
  busyLabel?: string;
  error?: string | null;
  max?: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [camera, setCamera] = useState(false);

  // One object URL per file, revoked when the file leaves the list.
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  const addFiles = (incoming: FileList | File[] | null | undefined) => {
    if (!incoming) return;
    const room = Math.max(0, max - files.length);
    const next = Array.from(incoming)
      .filter((f) => f.type.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name))
      .slice(0, room)
      .map((f) =>
        /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name)
          ? f
          : new File([f], withImageExtension(f.name || "photo", f.type), { type: f.type }),
      );
    if (next.length) onChange([...files, ...next]);
  };

  const remove = (idx: number) => onChange(files.filter((_, i) => i !== idx));
  const full = files.length >= max;

  if (camera) {
    return (
      <div className="mx-auto w-full max-w-column px-4 pb-6">
        <CameraStage
          facing="environment"
          filePrefix="design"
          onCapture={(file) => {
            addFiles([file]);
            setCamera(false);
          }}
          onCancel={() => setCamera(false)}
          onFallbackUpload={() => {
            setCamera(false);
            inputRef.current?.click();
          }}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-column flex-col gap-4 px-4 pb-6">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        disabled={busy}
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {/* Thumbnails — a 3-up grid; the last cell is "+ add" while room remains. */}
      {files.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-3 gap-2">
            {files.map((file, i) => (
              <div
                key={`${file.name}-${file.lastModified}-${i}`}
                className="relative aspect-[3/4] overflow-hidden rounded-card border border-hairline bg-mist-navy"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previews[i]}
                  alt={`Design photo ${i + 1}`}
                  className="h-full w-full object-cover"
                />
                <button
                  type="button"
                  aria-label={strings.autoDesign.removePhoto}
                  disabled={busy}
                  onClick={() => remove(i)}
                  className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-ink-navy/80 text-chalk-white shadow-card backdrop-blur transition-transform active:scale-90 disabled:opacity-50"
                >
                  <Close size={14} />
                </button>
              </div>
            ))}
            {!full && (
              <button
                type="button"
                disabled={busy}
                onClick={() => inputRef.current?.click()}
                className="flex aspect-[3/4] flex-col items-center justify-center gap-1.5 rounded-card border border-dashed border-hairline-strong bg-chalk-white text-muted transition-colors hover:border-navy-interactive hover:text-ink-navy disabled:opacity-50"
              >
                <Upload size={20} />
                <span className="text-[12px] font-medium">{strings.autoDesign.uploadCta}</span>
              </button>
            )}
          </div>
          <p className="text-right text-caption text-muted">
            {strings.autoDesign.photoCount(files.length, max)}
          </p>
        </div>
      )}

      {/* Upload / Take a photo — same pair as try-on's picker. */}
      {!full && (
        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="flex flex-col items-center justify-center gap-1.5 rounded-card border border-hairline-strong bg-chalk-white px-3 py-4 text-ink-navy transition-all hover:border-navy-interactive hover:shadow-card active:scale-[0.98] disabled:opacity-50"
          >
            <Upload size={22} className="text-accent-text" />
            <span className="text-body font-medium">{strings.autoDesign.uploadCta}</span>
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setCamera(true)}
            className="flex flex-col items-center justify-center gap-1.5 rounded-card border border-hairline-strong bg-chalk-white px-3 py-4 text-ink-navy transition-all hover:border-navy-interactive hover:shadow-card active:scale-[0.98] disabled:opacity-50"
          >
            <CameraGlyph />
            <span className="text-body font-medium">{strings.autoDesign.captureCta}</span>
          </button>
        </div>
      )}

      <p className="text-center text-caption text-muted">{strings.autoDesign.photoTip}</p>

      {error && (
        <p role="alert" className="text-center text-caption text-ember">
          {error}
        </p>
      )}

      <Button
        fullWidth
        disabled={files.length === 0 || busy}
        loading={busy}
        onClick={onAnalyze}
      >
        {busy ? busyLabel ?? strings.autoDesign.uploading : strings.autoDesign.analyzeCta}
      </Button>
    </div>
  );
}
