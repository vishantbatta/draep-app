"use client";

/**
 * Draep Button — Brand Book §8.
 *
 *   primary   : Tape Gradient fill, white bold label, pill. Pressed → Ember.
 *   secondary : 1.5px Ink Navy outline, navy label, transparent fill, pill.
 *
 * Always pill-shaped; no sharp corners. Tap target ≥44px (a11y §11).
 * Pressed state shifts the primary button toward Ember per §3.3.
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
      "text-chalk-white bg-tape shadow-brand hover:brightness-105 " +
      "active:bg-ember active:bg-none",
    secondary:
      "text-ink-navy bg-transparent border-[1.5px] border-ink-navy hover:bg-navy-bg",
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
