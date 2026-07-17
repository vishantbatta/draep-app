"use client";

/**
 * BottomSheet — slides up from the bottom of the viewport.
 * Used by the PriceBar breakdown (spec §5.3).
 *
 * Closes on backdrop tap and Escape. Locks body scroll while open.
 * Respects prefers-reduced-motion — Framer Motion handles this for us.
 */

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, type ReactNode } from "react";

import { clsx } from "clsx";

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  className?: string;
}

export function BottomSheet({ open, onClose, title, children, className }: BottomSheetProps) {
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
              "relative w-full max-w-column rounded-t-card bg-chalk-white shadow-brand",
              className,
            )}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="flex items-center justify-between px-4 pt-3 pb-2">
              <div className="mx-auto h-1 w-10 rounded-pill bg-tape-silver" aria-hidden />
            </div>
            <div className="px-4 pb-2">
              <h2 className="font-heading text-h2 text-ink-navy">{title}</h2>
            </div>
            <div className="px-4 pb-6 pt-1">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
