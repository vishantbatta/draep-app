/**
 * Bug (e) regression — 2026-09-04 GUI round.
 *
 * On a successful apply the old code nudged from
 * `dropped.find(d => d.code === applied_code) ?? dropped[0]`: when the
 * applied code did NOT drop but a sale lost the stacking pick, the sale's
 * entry (reason "superseded", code of its own) drove the nudge and the
 * generic-error fallback rendered under a success chip. The picker must
 * only ever speak about the code the user applied.
 */
import { describe, expect, it } from "vitest";
import { appliedPromoCodes, pickDroppedForNudge } from "@/lib/promo-ui";
import type { PromoDroppedDecision } from "@/types/api";

function drop(partial: Partial<PromoDroppedDecision>): PromoDroppedDecision {
  return {
    reason: "min_subtotal",
    code: null,
    label: null,
    gap_amount: null,
    missing_requirement: null,
    ...partial,
  };
}

describe("pickDroppedForNudge", () => {
  it("ignores a superseded sale when the applied code did not drop (bug e)", () => {
    const dropped = [
      drop({ reason: "superseded", code: null, label: { en: "Festive preview" } }),
    ];
    // A stored sale has no code; the applied code is absent from dropped.
    expect(pickDroppedForNudge("UTEST-10P", dropped)).toBeNull();
  });

  it("returns the applied code's own drop (min_subtotal gap)", () => {
    const mine = drop({ code: "UTEST-MIN", gap_amount: 521 });
    const sale = drop({ reason: "superseded", code: null });
    expect(pickDroppedForNudge("UTEST-MIN", [sale, mine])).toBe(mine);
  });

  it("returns the applied code's own drop (superseded by a better offer)", () => {
    const mine = drop({ reason: "superseded", code: "J2C" });
    expect(pickDroppedForNudge("J2C", [mine])).toBe(mine);
  });

  it("unknown typed code: returns the invalid-code entry (code null)", () => {
    const invalid = drop({ reason: "invalid_code", code: null });
    expect(pickDroppedForNudge(null, [invalid])).toBe(invalid);
  });

  it("add flow: an unknown typed code answers via the invalid-code entry", () => {
    const invalid = drop({ reason: "invalid_code", code: null });
    expect(pickDroppedForNudge("NOPE", [invalid])).toBe(invalid);
  });

  it("add flow: typed code not in dropped, superseded sale stays silent", () => {
    const sale = drop({ reason: "superseded", code: null });
    expect(pickDroppedForNudge("GOOD1", [sale])).toBeNull();
  });

  it("remove flow: dropped entries about other promos stay silent", () => {
    const sale = drop({ reason: "superseded", code: "FESTIVE" });
    expect(pickDroppedForNudge(null, [sale])).toBeNull();
    expect(pickDroppedForNudge(null, [])).toBeNull();
  });
});

describe("appliedPromoCodes", () => {
  it("uses the multi-code list in apply-order", () => {
    expect(appliedPromoCodes(["B-CODE", "A-CODE"], null)).toEqual([
      "B-CODE",
      "A-CODE",
    ]);
  });

  it("falls back to the legacy single column (pre-multi-coupon orders)", () => {
    expect(appliedPromoCodes(undefined, "OLD1")).toEqual(["OLD1"]);
    expect(appliedPromoCodes(null, "OLD1")).toEqual(["OLD1"]);
  });

  it("merges legacy in when missing from the list", () => {
    expect(appliedPromoCodes(["NEW1"], "OLD1")).toEqual(["NEW1", "OLD1"]);
  });

  it("dedupes and drops empties (defensive)", () => {
    expect(appliedPromoCodes(["A", "a", "  ", ""], "A")).toEqual(["A"]);
  });

  it("empty everywhere → no chips", () => {
    expect(appliedPromoCodes([], null)).toEqual([]);
  });
});
