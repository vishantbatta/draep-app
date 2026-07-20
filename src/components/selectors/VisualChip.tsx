"use client";

/**
 * VisualChip — Brand Book §5.4 + spec §5.4.
 *
 * Pill with 24px thumbnail glyph + label. NO text-only chips anywhere.
 * Silver outline default; orange fill + white text/glyph when selected.
 *
 * The thumbnail glyph is a small SVG that draws the option's shape — passed in
 * as a ReactNode so each chip can render its own (e.g. U-shape, V-shape).
 *
 * toggle-button semantics (aria-pressed) per a11y §11.
 */

import { clsx } from "clsx";
import type { ReactNode } from "react";

interface VisualChipProps {
  label: string;
  thumbnail: ReactNode;
  selected?: boolean;
  disabled?: boolean;
  priceLabel?: string;
  onPress: () => void;
  onPreviewStart?: () => void;
  onPreviewEnd?: () => void;
  className?: string;
}

export function VisualChip({
  label,
  thumbnail,
  selected,
  disabled,
  priceLabel,
  onPress,
  onPreviewStart,
  onPreviewEnd,
  className,
}: VisualChipProps) {
  return (
    <button
      type="button"
      role="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onPress}
      onPointerEnter={onPreviewStart}
      onPointerLeave={onPreviewEnd}
      onFocus={onPreviewStart}
      onBlur={onPreviewEnd}
      className={clsx(
        "inline-flex items-center gap-2 rounded-pill px-3 py-2 min-h-[44px]",
        "text-caption font-medium transition-all duration-200 ease-brand",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-interactive",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        selected
          ? "bg-tape text-chalk-white border border-draep-orange"
          : "bg-chalk-white border border-hairline-strong text-ink hover:border-navy-interactive",
        className,
      )}
    >
      <span
        className={clsx(
          "inline-flex h-6 w-6 flex-none items-center justify-center",
          selected ? "text-chalk-white" : "text-ink-navy",
        )}
      >
        {thumbnail}
      </span>
      <span>{label}</span>
      {priceLabel && (
        <span
          className={clsx(
            "ml-1 font-mono",
            selected ? "text-chalk-white/90" : "text-muted",
          )}
        >
          {priceLabel}
        </span>
      )}
    </button>
  );
}
