"use client";

/**
 * Chip — base pill component.
 *
 * Used directly for non-visual chips (e.g. step counters in the tape) and
 * extended by VisualChip (which adds a thumbnail glyph per §5.4).
 *
 * Brand Book §8: pill buttons only; never sharp corners.
 */

import { clsx } from "clsx";
import type { ReactNode } from "react";

interface ChipProps {
  children: ReactNode;
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
  ariaLabel?: string;
  ariaPressed?: boolean;
}

export function Chip({
  children,
  selected,
  disabled,
  onClick,
  className,
  ariaLabel,
  ariaPressed,
}: ChipProps) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={ariaPressed ?? selected}
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        "inline-flex items-center gap-2 rounded-pill px-3 py-2 min-h-[36px]",
        "text-caption font-medium transition-all duration-200 ease-brand",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-interactive",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        selected
          ? "bg-tape text-chalk-white border border-draep-orange"
          : "bg-chalk-white border border-hairline-strong text-ink hover:border-navy-interactive",
        className,
      )}
    >
      {children}
    </button>
  );
}
