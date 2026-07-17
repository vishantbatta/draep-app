/**
 * MonoNumber — wraps every ₹ amount, size, phone, order ID, slot (Brand Book §5).
 *
 * Forces IBM Plex Mono + tabular numerals. Drop a `<MonoNumber>` around any
 * numeric run instead of writing `font-mono` by hand — this guarantees the
 * tabular-nums feature setting stays consistent.
 */

import { clsx } from "clsx";
import type { ReactNode } from "react";

interface MonoNumberProps {
  children: ReactNode;
  className?: string;
}

export function MonoNumber({ children, className }: MonoNumberProps) {
  return (
    <span
      data-mono
      className={clsx(
        "font-mono",
        className,
      )}
      style={{ fontVariantNumeric: "tabular-nums" }}
    >
      {children}
    </span>
  );
}
