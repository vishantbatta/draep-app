"use client";

/**
 * BottomSheet — slides up from the bottom of the viewport.
 * Used by the PriceBar breakdown (spec §5.3).
 *
 * Closes on backdrop tap, Escape, or the floating close button above the
 * sheet's top-right corner. Locks body scroll while open.
 * Respects prefers-reduced-motion — Framer Motion handles this for us.
 */

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, type ReactNode } from "react";

import { clsx } from "clsx";

import { Close } from "@/components/ui/icons";

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  className?: string;
  footer?: ReactNode;
}

export function BottomSheet({
  open,
  onClose,
  title,
  children,
  className,
  footer,
}: BottomSheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <button
            aria-label="Close"
            onClick={onClose}
            className="absolute inset-0 bg-ink-navy/40 backdrop-blur-[1px]"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className={clsx(
              "relative w-full max-w-column rounded-t-sheet bg-chalk-white shadow-brand",
              "flex max-h-[92dvh] flex-col",
              className,
            )}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          >
            {/* Floating close — outside the sheet, above its top-right
                corner. Paints above the backdrop (sheet follows it in DOM
                order) and rides the slide-up animation. */}
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className={clsx(
                "absolute -top-12 right-4 flex h-9 w-9 items-center justify-center rounded-full",
                "border border-hairline bg-chalk-white text-ink-navy shadow-card",
                "transition-all ease-brand active:scale-95 active:bg-mist-navy",
              )}
            >
              <Close size={18} />
            </button>
            <div className="px-4 pt-4 pb-2">
              <h2 className="font-heading text-h2 text-ink-navy">{title}</h2>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-1">
              {children}
            </div>
            {footer && (
              <div className="border-t border-hairline bg-chalk-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
                {footer}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
