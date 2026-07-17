/**
 * DraepSymbol — the alpha-looped measuring tape (Brand Book §1).
 *
 * Symbol-only lockup. Used:
 *   - In the Logo primary lockup alongside the wordmark.
 *   - Standalone as the app icon (white curl on Tape Gradient tile).
 *   - Standalone reversed (full-color on white) for the favicon / avatar.
 *
 * Strokes are 2px rounded per iconography style. Gradient follows §4 (135°).
 */

import { clsx } from "clsx";
import type { CSSProperties } from "react";

export type SymbolVariant = "color" | "reversed" | "white";

interface DraepSymbolProps {
  variant?: SymbolVariant;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

export function DraepSymbol({
  variant = "color",
  className,
  style,
  title = "draep",
}: DraepSymbolProps) {
  const gradientId = `draep-tape-${variant}`;
  const stroke = variant === "white" ? "#FFFFFF" : "#083068";

  return (
    <svg
      viewBox="0 0 48 48"
      role="img"
      aria-label={title}
      className={clsx("block", className)}
      style={style}
    >
      <title>{title}</title>
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#F89010" />
          <stop offset="33%" stopColor="#E87810" />
          <stop offset="66%" stopColor="#D06010" />
          <stop offset="100%" stopColor="#A85010" />
        </linearGradient>
      </defs>

      {/* Alpha-tape loop: a single curve that crosses itself */}
      <path
        d="M9 30 C 9 18, 22 10, 30 16 C 38 22, 36 32, 26 33 C 18 34, 13 28, 18 22"
        fill="none"
        stroke={variant === "color" ? `url(#${gradientId})` : stroke}
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Tick marks along the tape (Brand Book §1, §6) */}
      <g stroke={variant === "color" ? `url(#${gradientId})` : stroke} strokeWidth="1.5" strokeLinecap="round">
        <line x1="11" y1="34" x2="11" y2="37" />
        <line x1="16" y1="34" x2="16" y2="37" />
        <line x1="21" y1="34" x2="21" y2="37" />
        <line x1="26" y1="34" x2="26" y2="37" />
        <line x1="31" y1="34" x2="31" y2="37" />
      </g>

      {/* Rivet dot — tape-end, terminates the symbol (Brand Book §6) */}
      <circle cx="9" cy="30" r="2.5" fill={variant === "color" ? `url(#${gradientId})` : stroke} />
    </svg>
  );
}
