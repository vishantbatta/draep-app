/**
 * ScreenShell — the centered max-w-480 column for every screen.
 *
 * Per spec §1: mobile-first 360–430px viewports; usable on desktop with a
 * centered max-width 480px column.
 *
 * Brand Book §4: page background is Warm Sand. Cards (chalk-white) sit on it
 * and earn their elevation through `shadow-card`.
 */

import { clsx } from "clsx";
import type { ReactNode } from "react";

interface ScreenShellProps {
  children: ReactNode;
  className?: string;
  /** Renders the bottom price bar correctly — adds bottom padding so content
   *  doesn't hide behind the sticky bar. */
  hasPriceBar?: boolean;
}

export function ScreenShell({ children, className, hasPriceBar }: ScreenShellProps) {
  return (
    <main
      className={clsx(
        "column min-h-dvh bg-warm-sand",
        hasPriceBar ? "pb-52" : "pb-6",
        className,
      )}
    >
      {children}
    </main>
  );
}
