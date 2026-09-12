/**
 * Walk-in v2 payment QR URL — WALKIN_V2_PLAN.md §5.5.
 *
 * The review screen encodes the direct app order URL with the walk-in gate
 * params: `?wi=1&ph=<phone>` (Phase 5 turns those into a login gate on
 * /app/orders/[id]).
 */
import { describe, expect, it } from "vitest";
import { walkInPayUrl } from "../walkin-qr";

describe("walkInPayUrl", () => {
  it("builds the direct app order URL with the walk-in gate params", () => {
    expect(walkInPayUrl("https://draep.com", "o-123", "9876543210")).toBe(
      "https://draep.com/app/orders/o-123?wi=1&ph=9876543210",
    );
  });

  it("keeps the origin as given (no trailing-slash doubling)", () => {
    expect(walkInPayUrl("http://localhost:3002/", "abc", "9876543210")).toBe(
      "http://localhost:3002/app/orders/abc?wi=1&ph=9876543210",
    );
  });

  it("URL-encodes the phone (defensive — 10 digits are safe already)", () => {
    expect(walkInPayUrl("https://x.dev", "o1", "+91 98")).toBe(
      "https://x.dev/app/orders/o1?wi=1&ph=%2B91%2098",
    );
  });
});
