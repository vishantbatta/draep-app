/**
 * Walk-in v2 plan F1 — shared phone normalization.
 *
 * `normalizePhoneInput` is the canonical national-number sanitizer, already
 * used by every /app login surface (/otp, LoginGateSheet, AppTabs). The
 * walk-in flow and the extracted PhoneLookupField (admin order creation)
 * adopt the same rule: strip non-digits, keep the LAST 10 digits so a
 * pasted "+91…" drops the country code instead of the final digits.
 *
 * Divergence from the old admin-local helper, kept deliberately: the old
 * code kept the FIRST 10 digits, so pasting "+919876543210" produced the
 * wrong number "9198765432". Last-10 fixes that. Trunk-prefix input
 * ("0" + 10 digits) resolves identically under both rules.
 */
import { describe, expect, it } from "vitest";
import {
  isValidNationalPhone,
  normalizePhoneInput,
  PHONE_DIGIT_COUNT,
} from "@/lib/phone";

describe("normalizePhoneInput", () => {
  it("strips every non-digit character", () => {
    expect(normalizePhoneInput("98765 43210")).toBe("9876543210");
    expect(normalizePhoneInput("98765-43210")).toBe("9876543210");
    expect(normalizePhoneInput("(987) 654-3210")).toBe("9876543210");
    expect(normalizePhoneInput("9876543210abc")).toBe("9876543210");
  });

  it("drops the country code when pasted with the number", () => {
    expect(normalizePhoneInput("+919876543210")).toBe("9876543210");
    expect(normalizePhoneInput("+91 98765 43210")).toBe("9876543210");
  });

  it("keeps over-long input's last 10 digits", () => {
    expect(normalizePhoneInput("987654321012345")).toBe("4321012345");
  });

  it("trunk prefix resolves like the old admin rule", () => {
    // "0" + full number (11 digits) → last 10 drops the leading zero.
    expect(normalizePhoneInput("09876543210")).toBe("9876543210");
  });

  it("single-digit-at-a-time typing is untouched", () => {
    expect(normalizePhoneInput("9")).toBe("9");
    expect(normalizePhoneInput("987")).toBe("987");
  });

  it("empty / letters-only input → empty string", () => {
    expect(normalizePhoneInput("")).toBe("");
    expect(normalizePhoneInput("   ")).toBe("");
    expect(normalizePhoneInput("abc")).toBe("");
  });
});

describe("isValidNationalPhone", () => {
  it("exactly 10 digits is valid", () => {
    expect(isValidNationalPhone("9876543210")).toBe(true);
  });

  it("partial or over-long numbers are invalid", () => {
    expect(isValidNationalPhone("")).toBe(false);
    expect(isValidNationalPhone("987654321")).toBe(false);
    expect(isValidNationalPhone("98765432101")).toBe(false);
  });
});

describe("PHONE_DIGIT_COUNT", () => {
  it("is 10 (Indian mobile)", () => {
    expect(PHONE_DIGIT_COUNT).toBe(10);
  });
});
