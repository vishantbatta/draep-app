"use client";

/**
 * ReviewRow — one row in the review summary list (spec §6.9).
 *
 * label (caption, navy-interactive) · value incl. sub-option (body, Ink Navy)
 * · price (mono, right-aligned) · chevron. Tap → deep-link to that screen
 * with ?from=review.
 */

import Link from "next/link";

import { ChevronRight } from "@/components/ui/icons";
import { MonoNumber } from "@/components/ui/MonoNumber";
import { formatPrice } from "@/lib/pricing";
import { strings } from "@/lib/strings";

interface ReviewRowProps {
  label: string;
  value: string;
  route?: string;
  price?: number;
  testId?: string;
}

export function ReviewRow({ label, value, route, price, testId }: ReviewRowProps) {
  const content = (
    <div
      id={`review-row-${testId}`}
      className="flex items-center gap-3 rounded-card px-4 py-3 transition-colors hover:bg-navy-bg"
    >
      <div className="flex-1 min-w-0">
        <p className="text-caption text-navy-interactive">{label}</p>
        <p className="mt-0.5 truncate text-body text-ink-navy">{value}</p>
      </div>
      {price !== undefined && price > 0 && (
        <MonoNumber className="text-data text-ink-navy/85">
          {formatPrice(price)}
        </MonoNumber>
      )}
      {price === 0 && (
        <span className="text-caption text-ink-navy/60">
          {strings.priceBar.included}
        </span>
      )}
      {route && (
        <ChevronRight size={16} className="text-ink-navy/50" strokeWidth={2.25} />
      )}
    </div>
  );

  if (!route) return content;

  return (
    <Link href={`${route}?from=review`} className="block">
      {content}
    </Link>
  );
}
