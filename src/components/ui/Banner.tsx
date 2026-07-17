"use client";

/**
 * Banner — semantic variants per Brand Book §4.
 *
 * success / warning / error / info. Each gets a tinted background derived
 * from the semantic tokens, with a 1.5px left rule for scannability.
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

const VARIANT_STYLES: Record<BannerVariant, { bg: string; border: string; icon: string }> = {
  success: { bg: "bg-[color-mix(in_srgb,var(--success)_12%,white)]", border: "var(--success)", icon: "✓" },
  warning: { bg: "bg-[color-mix(in_srgb,var(--warning)_14%,white)]", border: "var(--warning)", icon: "!" },
  error: { bg: "bg-[color-mix(in_srgb,var(--error)_12%,white)]", border: "var(--error)", icon: "!" },
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
  return (
    <div
      role={role}
      className={clsx(
        "flex items-start gap-3 rounded-card px-4 py-3",
        v.bg,
        className,
      )}
      style={{ borderLeft: `2px solid ${v.border}` }}
    >
      <span
        aria-hidden
        className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-pill text-body font-bold text-chalk-white"
        style={{ background: v.border }}
      >
        {v.icon}
      </span>
      <div className="flex-1 space-y-0.5">
        {title && <p className="font-heading text-h3 text-ink-navy">{title}</p>}
        {children && <div className="text-body text-ink-navy/85">{children}</div>}
      </div>
      {action && <div className="flex-none">{action}</div>}
    </div>
  );
}
