/**
 * Pure helpers for the coupon card's nudge logic — extracted from the
 * order-detail page 2026-09-04 (bug e) so the picking rule is testable
 * without React.
 */
import type { PromoDroppedDecision } from "@/types/api";

/**
 * Pick the ONE dropped decision the coupon card should speak about:
 * always and only the code the user just typed.
 *
 * When the typed code did not drop, there is nothing to say — a sale
 * that lost the stacking pick (`reason: "superseded"`) is not the user's
 * business and must not trigger the generic-error fallback (bug e).
 * An unknown code answers as a code-less `invalid_code` result, so that
 * entry also belongs to the typed code.
 */
export function pickDroppedForNudge(
  typedCode: string | null,
  dropped: PromoDroppedDecision[],
): PromoDroppedDecision | null {
  const invalid = dropped.find((d) => d.code == null && d.reason === "invalid_code");
  if (typedCode == null) {
    return invalid ?? null;
  }
  return dropped.find((d) => d.code === typedCode) ?? invalid ?? null;
}

/**
 * The order's held coupon codes for chip rendering: the new
 * applied_promo_codes list (apply-order), falling back to the legacy
 * single column for orders created before multi-coupon existed.
 * Duplicates and empties never survive (defensive — the backend already
 * dedupes).
 */
export function appliedPromoCodes(
  codes: string[] | null | undefined,
  legacyCode: string | null,
): string[] {
  const out: string[] = [];
  const combined = [...(codes ?? []), ...(legacyCode ? [legacyCode] : [])];
  for (const c of combined) {
    const norm = (c ?? "").trim().toUpperCase();
    if (norm && !out.includes(norm)) out.push(norm);
  }
  return out;
}
