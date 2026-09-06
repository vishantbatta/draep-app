/**
 * Bug (f) regression — 2026-09-04.
 *
 * The admin promotions page assumed paise (÷100 / ×100) against a backend
 * that stores whole rupees everywhere (garments.base_price 699 == ₹699).
 * A typed "₹200" was sent as 20000 and a stored 200 displayed as ₹2.
 * These helpers treat every money integer as whole rupees.
 */
import { describe, expect, it } from "vitest";
import { parseRupeesInput, rupeesToInput } from "@/lib/money";

describe("parseRupeesInput", () => {
  it("whole rupees pass through — no ×100 (bug f)", () => {
    expect(parseRupeesInput("200")).toBe(200);
    expect(parseRupeesInput("1500")).toBe(1500);
  });

  it("rounds stray decimals to the nearest rupee", () => {
    expect(parseRupeesInput("199.5")).toBe(200);
    expect(parseRupeesInput("99.4")).toBe(99);
  });

  it("empty and non-numeric input → null", () => {
    expect(parseRupeesInput("")).toBeNull();
    expect(parseRupeesInput("   ")).toBeNull();
    expect(parseRupeesInput("abc")).toBeNull();
  });
});

describe("rupeesToInput", () => {
  it("stored rupees render verbatim — no ÷100 (bug f)", () => {
    expect(rupeesToInput(200)).toBe("200");
    expect(rupeesToInput(1500)).toBe("1500");
  });

  it("null / undefined → empty string", () => {
    expect(rupeesToInput(null)).toBe("");
    expect(rupeesToInput(undefined)).toBe("");
  });
});
