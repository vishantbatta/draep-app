/**
 * Admin money inputs. The whole platform stores integer RUPEES (see
 * be/app/core/pricing.py — the historic "*_paise" names were a misnomer).
 * No ÷100/×100 paise math anywhere (bug f, 2026-09-04: the promotions
 * admin page scaled by 100, sending 20000 for a typed "₹200" and
 * displaying a stored 200 as ₹2).
 */

/** "199.5" (user-typed rupees) → 200 (integer rupees). "" / NaN → null. */
export function parseRupeesInput(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = parseFloat(t);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** Stored integer rupees → form input value. null / undefined → "". */
export function rupeesToInput(v: number | null | undefined): string {
  return v == null ? "" : String(v);
}
