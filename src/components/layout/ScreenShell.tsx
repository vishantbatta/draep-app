/**
 * ScreenShell — the centered max-w-480 column for every screen.
 *
 * Per spec §1: mobile-first 360–430px viewports; usable on desktop with a
 * centered max-width 480px column.
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
        "column min-h-dvh bg-chalk-white pb-6",
        hasPriceBar && "pb-64",
        className,
      )}
    >
      {children}
    </main>
  );
}
