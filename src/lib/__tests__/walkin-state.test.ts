/**
 * Walk-in v2 wizard state machine — WALKIN_V2_PLAN.md §5.1 / §2 (mirrored).
 *
 * The reducer is the single source of truth for the captain's wizard step;
 * the server snapshot (§4.7) is mapped in via RESUME. Check Now (§5.6) is
 * manual-only: CHECK_NOW_* transitions cover the in-flight guard and the
 * waiting→ready / waiting→cancelled mappings.
 */
import { describe, expect, it } from "vitest";

import {
  GO_BACK_STEPS,
  initialState,
  walkInReducer,
  walkInTokenExpired,
  type WalkInSnapshot,
} from "../walkin-state";

const PHONE = "7986147238";
const TOKEN = "tok-1";

function at(step: ReturnType<typeof initialState>["step"], over: Partial<ReturnType<typeof initialState>> = {}) {
  return { ...initialState(PHONE), step, ...over };
}

function snap(over: Partial<WalkInSnapshot> = {}): WalkInSnapshot {
  return {
    order_id: "o-1",
    order_number: "12345678901",
    stage: "configuring",
    user: { id: "u-1", name: "Riya", phone: PHONE },
    address: { id: "a-1" },
    garments: [],
    job_id: null,
    cod_selected: false,
    ...over,
  };
}

describe("walk-in wizard — happy path", () => {
  it("starts on the phone step", () => {
    expect(initialState().step).toBe("phone");
  });

  it("advances phone → otp only on a complete 10-digit number", () => {
    const s = walkInReducer(initialState(), { type: "PHONE_SUBMITTED", phone: PHONE });
    expect(s.step).toBe("otp");
    expect(s.phone).toBe(PHONE);

    const bad = walkInReducer(initialState(), { type: "PHONE_SUBMITTED", phone: "798" });
    expect(bad.step).toBe("phone");
  });

  it("routes an existing customer straight to address after OTP", () => {
    const s = walkInReducer(at("otp", { isNewUser: false }), {
      type: "OTP_VERIFIED",
      token: TOKEN,
      expiresAt: "2026-09-11T10:15:00Z",
    });
    expect(s.step).toBe("address");
    expect(s.verificationToken).toBe(TOKEN);
    expect(s.tokenExpiresAt).toBe("2026-09-11T10:15:00Z");
  });

  it("routes a new customer through the name step after OTP", () => {
    const s = walkInReducer(at("otp", { isNewUser: true }), {
      type: "OTP_VERIFIED",
      token: TOKEN,
      expiresAt: "2026-09-11T10:15:00Z",
    });
    expect(s.step).toBe("name");
  });

  it("records the name and moves to address", () => {
    const s = walkInReducer(at("name", { isNewUser: true }), {
      type: "NAME_CONFIRMED",
      name: "Riya",
    });
    expect(s.step).toBe("address");
    expect(s.customerName).toBe("Riya");
  });

  it("order creation consumes the verification token and moves to order-created", () => {
    const s = walkInReducer(
      at("address", { verificationToken: TOKEN, tokenExpiresAt: "2026-09-11T10:15:00Z" }),
      {
        type: "ORDER_CREATED",
        orderId: "o-1",
        orderNumber: "12345678901",
        userId: "u-1",
        isNewUser: true,
      },
    );
    expect(s.step).toBe("order-created");
    expect(s.orderId).toBe("o-1");
    expect(s.orderNumber).toBe("12345678901");
    expect(s.userId).toBe("u-1");
    expect(s.verificationToken).toBeNull(); // spent
    expect(s.tokenExpiresAt).toBeNull();
  });

  it("walks garment-pick → garment-config → review → wait", () => {
    let s = walkInReducer(at("order-created", { orderId: "o-1" }), { type: "BEGIN_GARMENTS" });
    expect(s.step).toBe("garment-pick");
    s = walkInReducer(s, { type: "GARMENT_PICKED" });
    expect(s.step).toBe("garment-config");
    s = walkInReducer(s, { type: "GARMENT_CONFIG_DONE" });
    expect(s.step).toBe("review");
    s = walkInReducer(s, { type: "QR_SHOWN" });
    expect(s.step).toBe("wait");
  });
});

describe("walk-in wizard — Check Now (§5.6 manual check)", () => {
  it("sets the in-flight guard and ignores a double-tap", () => {
    let s = walkInReducer(at("wait"), { type: "CHECK_NOW_START" });
    expect(s.checking).toBe(true);
    s = walkInReducer(s, { type: "CHECK_NOW_START" });
    expect(s.checking).toBe(true);
    expect(s.lastCheckedAt).toBeNull();
  });

  it("waiting → paid: stays on wait with the Start CTA unblocked", () => {
    let s = walkInReducer(at("wait"), { type: "CHECK_NOW_START" });
    s = walkInReducer(s, {
      type: "CHECK_NOW_RESULT",
      ready: true,
      codSelected: false,
      fulfillmentStatus: "awaiting_visit",
      now: 1_000,
    });
    expect(s.step).toBe("wait");
    expect(s.paid).toBe(true);
    expect(s.checking).toBe(false);
    expect(s.lastCheckedAt).toBe(1_000);
    expect(s.error).toBeNull();
  });

  it("still unpaid: stays waiting, paid stays false", () => {
    let s = walkInReducer(at("wait"), { type: "CHECK_NOW_START" });
    s = walkInReducer(s, {
      type: "CHECK_NOW_RESULT",
      ready: false,
      codSelected: false,
      fulfillmentStatus: "draft",
      now: 1_000,
    });
    expect(s.step).toBe("wait");
    expect(s.paid).toBe(false);
    expect(s.checking).toBe(false);
  });

  it("waiting → cancelled maps to the cancelled step", () => {
    let s = walkInReducer(at("wait"), { type: "CHECK_NOW_START" });
    s = walkInReducer(s, {
      type: "CHECK_NOW_RESULT",
      ready: false,
      codSelected: false,
      fulfillmentStatus: "cancelled",
      now: 1_000,
    });
    expect(s.step).toBe("cancelled");
  });

  it("network error re-enables the button with an inline retry message", () => {
    let s = walkInReducer(at("wait"), { type: "CHECK_NOW_START" });
    s = walkInReducer(s, { type: "CHECK_NOW_ERROR", message: "Network error" });
    expect(s.step).toBe("wait");
    expect(s.checking).toBe(false);
    expect(s.error).toBe("Network error");
    expect(s.paid).toBe(false);
    // …and a retry works after the error.
    s = walkInReducer(s, { type: "CHECK_NOW_START" });
    expect(s.checking).toBe(true);
    expect(s.error).toBeNull();
  });

  it("starting measurement requires payment confirmed", () => {
    const blocked = walkInReducer(at("wait", { paid: false }), {
      type: "MEASUREMENT_STARTED",
      jobId: "job-1",
    });
    expect(blocked.step).toBe("wait"); // no-op

    const ok = walkInReducer(at("wait", { paid: true }), {
      type: "MEASUREMENT_STARTED",
      jobId: "job-1",
    });
    expect(ok.step).toBe("done");
    expect(ok.jobId).toBe("job-1");
  });
});

describe("walk-in wizard — drop / expiry", () => {
  it("cancel from the wait screen lands on cancelled", () => {
    const s = walkInReducer(at("wait"), { type: "WALKIN_CANCELLED" });
    expect(s.step).toBe("cancelled");
  });

  it("cancel is ignored once measuring is done", () => {
    const s = walkInReducer(at("done", { jobId: "job-1" }), { type: "WALKIN_CANCELLED" });
    expect(s.step).toBe("done");
  });

  it("token expiry sends the captain back to OTP with the phone preserved", () => {
    const s = walkInReducer(
      at("address", { verificationToken: TOKEN, tokenExpiresAt: "2026-09-11T10:15:00Z" }),
      { type: "TOKEN_EXPIRED" },
    );
    expect(s.step).toBe("otp");
    expect(s.phone).toBe(PHONE);
    expect(s.verificationToken).toBeNull();
    expect(s.error).toContain("expired");
  });

  it("walkInTokenExpired boundary", () => {
    expect(walkInTokenExpired("2026-09-11T10:15:00Z", Date.parse("2026-09-11T10:14:59Z"))).toBe(false);
    expect(walkInTokenExpired("2026-09-11T10:15:00Z", Date.parse("2026-09-11T10:15:01Z"))).toBe(true);
  });
});

describe("walk-in wizard — back navigation preserves drafts", () => {
  it("address (existing) → otp keeps phone and token", () => {
    const s = walkInReducer(at("address", { verificationToken: TOKEN }), { type: "GO_BACK" });
    expect(s.step).toBe("otp");
    expect(s.phone).toBe(PHONE);
    expect(s.verificationToken).toBe(TOKEN);
  });

  it("garment-config → garment-pick keeps the order id", () => {
    const s = walkInReducer(at("garment-config", { orderId: "o-1" }), { type: "GO_BACK" });
    expect(s.step).toBe("garment-pick");
    expect(s.orderId).toBe("o-1");
  });

  it("the wait screen is a hard block — GO_BACK is a no-op", () => {
    const s = walkInReducer(at("wait", { orderId: "o-1" }), { type: "GO_BACK" });
    expect(s.step).toBe("wait");
  });

  it("documents the back map", () => {
    expect(GO_BACK_STEPS).toEqual({
      otp: "phone",
      name: "otp",
      address: "otp",
      "order-created": "address",
      "garment-pick": "order-created",
      "garment-config": "garment-pick",
      review: "garment-pick",
    });
  });
});

describe("walk-in wizard — resume from server snapshot (§4.7)", () => {
  it("configuring with no garments resumes at garment-pick", () => {
    const s = walkInReducer(initialState(), { type: "RESUME", snapshot: snap() });
    expect(s.step).toBe("garment-pick");
    expect(s.orderId).toBe("o-1");
    expect(s.orderNumber).toBe("12345678901");
    expect(s.userId).toBe("u-1");
    expect(s.customerName).toBe("Riya");
    expect(s.phone).toBe(PHONE);
    expect(s.addressId).toBe("a-1");
  });

  it("configuring with garments resumes at review", () => {
    const s = walkInReducer(initialState(), {
      type: "RESUME",
      snapshot: snap({ garments: [{ garment_order_id: "go-1" }] }),
    });
    expect(s.step).toBe("review");
  });

  it("ready resumes on the wait screen with payment confirmed (Start CTA)", () => {
    const s = walkInReducer(initialState(), {
      type: "RESUME",
      snapshot: snap({ stage: "ready", cod_selected: true }),
    });
    expect(s.step).toBe("wait");
    expect(s.paid).toBe(true);
    expect(s.codSelected).toBe(true);
  });

  it("measuring resumes as done with the job id (page redirects to the wizard)", () => {
    const s = walkInReducer(initialState(), {
      type: "RESUME",
      snapshot: snap({ stage: "measuring", job_id: "job-9" }),
    });
    expect(s.step).toBe("done");
    expect(s.jobId).toBe("job-9");
  });

  it("cancelled resumes as the cancelled card", () => {
    const s = walkInReducer(initialState(), {
      type: "RESUME",
      snapshot: snap({ stage: "cancelled" }),
    });
    expect(s.step).toBe("cancelled");
  });
});

describe("PHONE_SUBMITTED lookup payload (page → reducer contract)", () => {
  it("carries the lookup result into state before the OTP step", () => {
    const s = walkInReducer(initialState(), {
      type: "PHONE_SUBMITTED",
      phone: PHONE,
      isNewUser: true,
      customerName: "Ishita Rao",
    });
    expect(s.step).toBe("otp");
    expect(s.isNewUser).toBe(true);
    expect(s.customerName).toBe("Ishita Rao");
    // new-user route continues through the name step pre-seeded
    const named = walkInReducer(s, {
      type: "OTP_VERIFIED",
      token: "tok",
      expiresAt: "2099-01-01T00:00:00Z",
    });
    expect(named.step).toBe("name");
  });

  it("defaults to existing-user when the lookup fields are omitted", () => {
    const s = walkInReducer(initialState(), { type: "PHONE_SUBMITTED", phone: PHONE });
    expect(s.isNewUser).toBe(false);
    expect(s.step).toBe("otp");
  });
});

describe("REVIEW_NOW (garment-pick → review shortcut)", () => {
  it("moves garment-pick to review once at least one garment exists", () => {
    const s = walkInReducer(at("garment-pick"), { type: "REVIEW_NOW", hasGarments: true });
    expect(s.step).toBe("review");
  });

  it("stays on garment-pick when the order still has no garments", () => {
    const s = walkInReducer(at("garment-pick"), { type: "REVIEW_NOW", hasGarments: false });
    expect(s.step).toBe("garment-pick");
  });

  it("is a no-op from any other step", () => {
    for (const step of ["review", "order-created", "wait"] as const) {
      const s = walkInReducer(at(step), { type: "REVIEW_NOW", hasGarments: true });
      expect(s.step).toBe(step);
    }
  });
});
