/**
 * PriceBreakdown — the rate-card table with orange total row.
 *
 * Brand Book §8 — `.rate` pattern: dashed Tape Silver row dividers, navy mono
 * prices, ember total row. Used in /review above the price bar AND inside the
 * PriceBar's bottom sheet. One source of truth — computePrice — feeds both.
 */

import { MonoNumber } from "@/components/ui/MonoNumber";
import { computePrice, formatPrice } from "@/lib/pricing";
import { strings } from "@/lib/strings";
import type { BookingDraft } from "@/types/booking";

interface PriceBreakdownProps {
  draft: BookingDraft;
  /** Show the total row in orange (default) or as a neutral summary (for inline use). */
  highlightTotal?: boolean;
}

export function PriceBreakdown({ draft, highlightTotal = true }: PriceBreakdownProps) {
  const price = computePrice(draft);

  return (
    <div className="overflow-hidden rounded-card border border-hairline bg-chalk-white">
      <table className="w-full border-collapse text-body">
        <tbody>
          {price.lines.map((line, idx) => (
            <tr
              key={`${line.label}-${idx}`}
              className="border-b border-dashed border-tape-silver last:border-b-0"
            >
              <td className="bg-chalk-white px-4 py-3 text-ink">{line.label}</td>
              <td className="bg-chalk-white px-4 py-3 text-right">
                {line.amount === 0 ? (
                  <span className="text-caption text-muted">
                    {strings.priceBar.included}
                  </span>
                ) : (
                  <MonoNumber className="text-data text-ink-navy">
                    {formatPrice(line.amount)}
                  </MonoNumber>
                )}
              </td>
            </tr>
          ))}
          <tr
            className={
              highlightTotal
                ? "bg-tape text-chalk-white"
                : "bg-mist-navy text-ink-navy"
            }
          >
            <td className="px-4 py-3 font-heading font-semibold">
              {strings.review.total}
            </td>
            <td className="px-4 py-3 text-right">
              <MonoNumber className="text-data font-semibold">
                {formatPrice(price.total)}
              </MonoNumber>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
