/**
 * Banner — semantic variants per Brand Book §4 / §8.
 *
 * success / warning / error / info. Brand-book spec colors (E8F1EC / FCE9E7 etc.)
 * with a 1.5px left rule for scannability. Border + tint derived from semantic
 * tokens so dark mode stays consistent.
 */

import { clsx } from "clsx";
import type { ReactNode } from "react";

type BannerVariant = "success" | "warning" | "error" | "info";

interface BannerProps {
  variant: BannerVariant;
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
  role?: "alert" | "status";
}

const VARIANT_STYLES: Record<
  BannerVariant,
  { bg: string; border: string; icon: string }
> = {
  // Brand Book §8 — .ok / .alert use these tones.
  success: { bg: "bg-success-bg", border: "var(--success-border)", icon: "✓" },
  warning: {
    bg: "bg-[color-mix(in_srgb,var(--warning)_14%,white)]",
    border: "var(--warning)",
    icon: "!",
  },
  error: { bg: "bg-error-bg", border: "var(--error-border)", icon: "!" },
  info: { bg: "bg-[color-mix(in_srgb,var(--info)_12%,white)]", border: "var(--info)", icon: "i" },
};

export function Banner({
  variant,
  title,
  children,
  action,
  className,
  role = variant === "error" ? "alert" : "status",
}: BannerProps) {
  const v = VARIANT_STYLES[variant];
  // The visible accent stripe + icon use the saturated semantic color, not the border tint.
  const accent =
    variant === "success"
      ? "var(--success)"
      : variant === "error"
        ? "var(--error)"
        : variant === "warning"
          ? "var(--warning)"
          : "var(--info)";
  return (
    <div
      role={role}
      className={clsx(
        "flex items-start gap-3 rounded-card border px-4 py-3",
        v.bg,
        className,
      )}
      style={{ borderLeft: `1.5px solid ${accent}` }}
    >
      <span
        aria-hidden
        className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-pill text-body font-bold text-chalk-white"
        style={{ background: accent }}
      >
        {v.icon}
      </span>
      <div className="flex-1 space-y-0.5">
        {title && <p className="font-heading text-h3 text-ink-navy">{title}</p>}
        {children && <div className="text-body text-ink/85">{children}</div>}
      </div>
      {action && <div className="flex-none">{action}</div>}
    </div>
  );
}
