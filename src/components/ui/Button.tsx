"use client";

/**
 * Draep Button — Brand Book §8 (.btn-primary spec).
 *
 *   primary   : Tape Gradient fill (#F89010 → #A85010), white bold label, pill.
 *               Exact spec: .btn-primary{background:var(--grad);color:#fff;
 *               border-radius:999px;padding:12px 30px;
 *               box-shadow:0 4px 12px rgba(208,96,16,.28)}
 *               Pressed → Ember (#D06010) per §3.3.
 *   secondary : 1.5px Ink Navy outline, navy label, transparent fill, pill.
 *
 * Always pill-shaped; no sharp corners. Tap target ≥44px (a11y §11).
 */

import { clsx } from "clsx";
import { forwardRef, type ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  fullWidth?: boolean;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", fullWidth, loading, className, children, disabled, ...rest },
  ref,
) {
  const base =
    "relative inline-flex items-center justify-center gap-2 rounded-pill px-5 min-h-[44px] " +
    "font-heading font-semibold text-body transition-all duration-200 ease-brand " +
    "disabled:opacity-50 disabled:cursor-not-allowed " +
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-interactive " +
    "active:scale-[0.98]";

  const variants: Record<Variant, string> = {
    primary:
      "text-chalk-white bg-tape shadow-primary hover:brightness-105 " +
      "active:bg-ember active:bg-none active:shadow-none",
    secondary:
      "text-ink-navy bg-transparent border-[1.5px] border-ink-navy hover:bg-mist-navy",
  };

  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={clsx(base, variants[variant], fullWidth && "w-full", className)}
      {...rest}
    >
      {loading && (
        <span
          aria-hidden
          className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
        />
      )}
      <span className={clsx(loading && "opacity-80")}>{children}</span>
    </button>
  );
});
