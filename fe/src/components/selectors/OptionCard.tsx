"use client";

/**
 * OptionCard — Brand Book §5.4 + spec §5.4.
 *
 * Illustration (mandatory — never label-only) + label, 12px radius, 2-col grid.
 * States:
 *   default  : white bg, silver 1px border
 *   selected : orange-fill bg, 1.5px orange border, orange tick badge
 *   pressed  : ember border (handled via Tailwind active:)
 *
 * Radio semantics (role=radio) for full keyboard support (a11y §11).
 *
 * `onPreview` is fired on hover/press to drive the BlousePreview ghost-preview.
 */

import { clsx } from "clsx";
import type { ReactNode } from "react";
import { forwardRef } from "react";

import { Check } from "@/components/ui/icons";

interface OptionCardProps {
  label: string;
  illustration: ReactNode;
  selected?: boolean;
  isDefault?: boolean;
  priceLabel?: string;
  onSelect: () => void;
  onPreviewStart?: () => void;
  onPreviewEnd?: () => void;
  className?: string;
}

export const OptionCard = forwardRef<HTMLButtonElement, OptionCardProps>(
  function OptionCard(
    {
      label,
      illustration,
      selected,
      isDefault,
      priceLabel,
      onSelect,
      onPreviewStart,
      onPreviewEnd,
      className,
    },
    ref,
  ) {
    return (
      <div className={clsx("relative", className)}>
        <button
          ref={ref}
          type="button"
          role="radio"
          aria-checked={selected}
          onClick={onSelect}
          onPointerEnter={onPreviewStart}
          onPointerLeave={onPreviewEnd}
          onFocus={onPreviewStart}
          onBlur={onPreviewEnd}
          className={clsx(
            "block w-full rounded-card p-3 text-left transition-all duration-200 ease-brand",
            "min-h-[160px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-interactive",
            selected
              ? "bg-orange-fill border-[1.5px] border-draep-orange shadow-card"
              : "bg-chalk-white border border-hairline hover:border-navy-interactive hover:shadow-card",
            "active:border-ember",
          )}
        >
          <div className="flex h-24 items-center justify-center text-ink-navy">
            {illustration}
          </div>
          <div className="mt-2">
            <p
              className={clsx(
                "font-heading text-h3 text-ink-navy",
              )}
            >
              {label}
            </p>
            {priceLabel && (
              <p className="mt-0.5 font-mono text-caption text-muted">
                {priceLabel}
              </p>
            )}
          </div>
        </button>

        {selected && (
          <span
            aria-hidden
            className="absolute right-3 top-3 inline-flex h-6 w-6 items-center justify-center rounded-pill bg-tape text-chalk-white shadow-primary"
          >
            <Check size={14} strokeWidth={2.5} />
          </span>
        )}

        {isDefault && !selected && (
          <span className="absolute left-3 top-3 inline-flex items-center rounded-pill bg-orange-fill px-2 py-0.5 text-caption font-medium text-ink-navy">
            Default
          </span>
        )}
      </div>
    );
  },
);
