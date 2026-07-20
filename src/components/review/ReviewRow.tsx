"use client";

/**
 * ReviewRow — one row in the review summary list (spec §6.9).
 *
 * label (caption, navy-interactive) · value incl. sub-option (body, Ink Navy)
 * · price (mono, right-aligned) · chevron. Tap → opens the inline edit sheet
 * (no navigation back to the design step).
 */

import { ChevronRight } from "@/components/ui/icons";
import { MonoNumber } from "@/components/ui/MonoNumber";
import { formatPrice } from "@/lib/pricing";
import { strings } from "@/lib/strings";

interface ReviewRowProps {
  label: string;
  value: string;
  testId: string;
  price?: number;
  onEdit?: (testId: string) => void;
}

export function ReviewRow({ label, value, testId, price, onEdit }: ReviewRowProps) {
  return (
    <button
      type="button"
      id={`review-row-${testId}`}
      onClick={() => onEdit?.(testId)}
      className="flex w-full items-center gap-3 rounded-card border border-hairline bg-chalk-white px-4 py-3 text-left transition-colors hover:bg-mist-navy hover:border-navy-interactive"
    >
      <div className="flex-1 min-w-0">
        <p className="text-caption text-muted">{label}</p>
        <p className="mt-0.5 truncate text-body text-ink-navy">{value}</p>
      </div>
      {price !== undefined && price > 0 && (
        <MonoNumber className="text-data text-ink-navy">
          {formatPrice(price)}
        </MonoNumber>
      )}
      {price !== undefined && price === 0 && (
        <span className="text-caption text-muted">
          {strings.priceBar.included}
        </span>
      )}
      <ChevronRight size={16} className="text-muted" strokeWidth={2.25} />
    </button>
  );
}
