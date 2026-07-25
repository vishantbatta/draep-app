"use client";

import { useEffect, type ReactNode } from "react";

/**
 * BottomSheet — reusable bottom sheet overlay.
 *
 * Slides up from the bottom of the screen with a backdrop, drag handle,
 * optional title, and a scrollable content area. Body scroll is locked
 * while open. Escape closes.
 */
export function BottomSheet({
  title,
  onClose,
  children,
}: {
  title?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  // Lock body scroll while sheet is open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      {/* Backdrop */}
      <button
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-ink-navy/50 backdrop-blur-sm"
      />

      {/* Sheet */}
      <div className="relative z-10 max-h-[90vh] w-full max-w-[480px] overflow-y-auto rounded-t-[1.5rem] border border-hairline bg-chalk-white shadow-2xl animate-slide-up">
        {/* Drag handle */}
        <div className="flex justify-center pt-2">
          <span className="h-1 w-10 rounded-full bg-hairline-strong" />
        </div>

        {/* Header */}
        {title && (
          <div className="flex items-center justify-between gap-2 px-4 pt-2">
            <h2 className="font-heading text-h4 font-semibold leading-tight text-ink-navy">
              {title}
            </h2>
            <button
              onClick={onClose}
              className="tap shrink-0 rounded-pill bg-mist-navy px-3 py-1 text-[12px] font-medium text-ink-navy"
            >
              ✕
            </button>
          </div>
        )}

        {/* Content */}
        <div className="px-4 pb-6 pt-2">{children}</div>
      </div>
    </div>
  );
}
