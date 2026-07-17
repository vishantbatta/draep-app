/**
 * Draep Logo — lockups per Brand Book §1.
 *
 *   primary   : symbol + lowercase wordmark, horizontal. Default.
 *   symbol    : symbol only. App icon, favicons, avatars.
 *   wordmark  : wordmark only. Used when symbol appears separately nearby.
 *   reversed  : white wordmark + full-color symbol on Ink Navy.
 *
 * Hard rules enforced here (Brand Book §3.5):
 *   - Wordmark is always lowercase "draep", never uppercase or another face.
 *   - Symbol min 24px on screen (caller responsibility; enforced as min-w/h).
 *   - Primary lockup min 96px wide (caller responsibility).
 *   - Clearspace = height of wordmark's "d" bowl on all sides.
 */

import { clsx } from "clsx";

import { DraepSymbol, type SymbolVariant } from "@/components/brand/DraepSymbol";

type LogoLockup = "primary" | "symbol" | "wordmark" | "reversed";

interface LogoProps {
  lockup?: LogoLockup;
  className?: string;
  symbolClassName?: string;
}

const WORDMARK_REVERSED = "#FFFFFF";

export function Logo({
  lockup = "primary",
  className,
  symbolClassName,
}: LogoProps) {
  if (lockup === "symbol") {
    return (
      <span className={clsx("inline-block min-h-[24px] min-w-[24px]", className)}>
        <DraepSymbol variant="color" className={clsx("h-full w-full", symbolClassName)} />
      </span>
    );
  }

  if (lockup === "wordmark") {
    return (
      <span
        className={clsx(
          "font-heading font-bold lowercase tracking-tight text-ink-navy",
          className,
        )}
        style={{ fontSize: "1.5rem" }}
      >
        draep
      </span>
    );
  }

  const reversed = lockup === "reversed";
  const wordmarkColor = reversed ? WORDMARK_REVERSED : "#083068";
  const symbolVariant: SymbolVariant = "color";

  // Clearspace margin = height of "d" bowl ≈ 0.6em on the wordmark.
  return (
    <span
      className={clsx("inline-flex items-center gap-[0.45em]", className)}
      style={{ minWidth: 96 }}
    >
      <DraepSymbol
        variant={symbolVariant}
        className={clsx("h-[1.4em] w-[1.4em] min-h-[24px] min-w-[24px]", symbolClassName)}
      />
      <span
        className="font-heading font-bold lowercase leading-none tracking-tight"
        style={{ color: wordmarkColor, fontSize: "1.5rem" }}
      >
        draep
      </span>
    </span>
  );
}
