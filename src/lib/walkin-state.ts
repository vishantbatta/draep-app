/**
 * Walk-in v2 wizard state machine — WALKIN_V2_PLAN.md §5.1 / §2 (FE mirror).
 *
 * Pure reducer + types so the whole captain wizard is testable in vitest's
 * node env; the page wraps it in a `useReducer`. The server owns the durable
 * stage (`configuring | ready | measuring | cancelled`, §4.7 snapshot); this
 * machine owns the client-only refinements — the finer wizard steps and the
 * QR-shown `awaiting_customer` state, which lives only as the `wait` step.
 *
 * Check Now (§5.6) is manual: `CHECK_NOW_START/RESULT/ERROR` transitions with
 * an in-flight guard — no timers, no polling.
 */

import { isValidNationalPhone } from "./phone";

export type WIStep =
  | "phone" // Step 1 — phone entry + lookup (admin-parity validation)
  | "otp" // Step 1.1 — captain types the customer's OTP
  | "name" // new customers only — name before address
  | "address" // Step 2 — pick/create address (skip allowed)
  | "order-created" // Step 3 entry — empty draft order exists (§4.4)
  | "garment-pick" // Step 3a — choose garment type
  | "garment-config" // Step 3b — MYOD-like configuration (§5.4)
  | "review" // Step 3c — order review + QR (§5.5)
  | "wait" // Step 4 — hard block, QR shown, manual Check Now (§5.6)
  | "done" // measurement job started → page redirects to the wizard
  | "cancelled"; // dropped by the captain (§4.11) or cancelled elsewhere

/** Steps a GO_BACK is allowed from → the step it returns to. */
export const GO_BACK_STEPS: Partial<Record<WIStep, WIStep>> = {
  otp: "phone",
  name: "otp",
  address: "otp",
  "order-created": "address",
  "garment-pick": "order-created",
  "garment-config": "garment-pick",
  review: "garment-pick",
  // wait is a hard block; done/cancelled are terminal — no back.
};

export interface WalkInState {
  step: WIStep;
  /** Normalized 10-digit national number. */
  phone: string;
  isNewUser: boolean;
  customerName: string | null;
  userId: string | null;
  /** Captain-typed-OTP proof (§4.3). Memory only — never persisted. */
  verificationToken: string | null;
  tokenExpiresAt: string | null;
  addressId: string | null;
  orderId: string | null;
  orderNumber: string | null;
  jobId: string | null;
  /** Check Now in-flight guard (§5.6). */
  checking: boolean;
  /** Payment (or COD) confirmed — unblocks the Start Measurement CTA. */
  paid: boolean;
  codSelected: boolean;
  /** Epoch ms of the last completed Check Now ("Last checked HH:MM"). */
  lastCheckedAt: number | null;
  error: string | null;
}

export function initialState(phone = ""): WalkInState {
  return {
    step: "phone",
    phone,
    isNewUser: false,
    customerName: null,
    userId: null,
    verificationToken: null,
    tokenExpiresAt: null,
    addressId: null,
    orderId: null,
    orderNumber: null,
    jobId: null,
    checking: false,
    paid: false,
    codSelected: false,
    lastCheckedAt: null,
    error: null,
  };
}

/** Shape of GET /style-captain/walk-in/orders/{id} (§4.7) as the FE needs it. */
export interface WalkInSnapshot {
  order_id: string;
  order_number: string | null;
  stage: "configuring" | "ready" | "measuring" | "cancelled";
  user: { id: string; name: string | null; phone: string | null };
  address: { id: string } | null;
  garments: { garment_order_id: string }[];
  job_id: string | null;
  cod_selected: boolean;
}

export type WalkInAction =
  | {
      type: "PHONE_SUBMITTED";
      phone: string;
      /** Lookup completed by now — carry its result into the flow. */
      isNewUser?: boolean;
      userId?: string | null;
      customerName?: string | null;
    }
  | { type: "OTP_VERIFIED"; token: string; expiresAt: string }
  | { type: "NAME_CONFIRMED"; name: string }
  | {
      type: "ORDER_CREATED";
      orderId: string;
      orderNumber: string;
      userId: string;
      isNewUser: boolean;
    }
  | { type: "BEGIN_GARMENTS" }
  | { type: "GARMENT_PICKED" }
  | { type: "GARMENT_CONFIG_DONE" }
  | { type: "EDIT_GARMENT" }
  | { type: "ADD_ANOTHER_GARMENT" }
  /** garment-pick → review shortcut; ignored while the order has no garments. */
  | { type: "REVIEW_NOW"; hasGarments: boolean }
  | { type: "QR_SHOWN" }
  | { type: "CHECK_NOW_START" }
  | {
      type: "CHECK_NOW_RESULT";
      ready: boolean;
      codSelected: boolean;
      fulfillmentStatus: string | null;
      now: number;
    }
  | { type: "CHECK_NOW_ERROR"; message: string }
  | { type: "MEASUREMENT_STARTED"; jobId: string }
  | { type: "WALKIN_CANCELLED" }
  | { type: "TOKEN_EXPIRED" }
  | { type: "GO_BACK" }
  | { type: "RESUME"; snapshot: WalkInSnapshot }
  | { type: "RESET" };

/** True once the verification token's 15-minute window has passed (§4.3). */
export function walkInTokenExpired(
  expiresAt: string | null,
  nowMs: number = Date.now(),
): boolean {
  if (!expiresAt) return true;
  return nowMs >= Date.parse(expiresAt);
}

function resumeStep(snapshot: WalkInSnapshot): WIStep {
  switch (snapshot.stage) {
    case "cancelled":
      return "cancelled";
    case "measuring":
      return "done";
    case "ready":
      return "wait";
    // Server can't see QR-shown; configuring resumes before the QR —
    // no garments yet → pick, garments already added → review.
    default:
      return snapshot.garments.length > 0 ? "review" : "garment-pick";
  }
}

export function walkInReducer(state: WalkInState, action: WalkInAction): WalkInState {
  switch (action.type) {
    case "PHONE_SUBMITTED": {
      if (!isValidNationalPhone(action.phone)) return state;
      return {
        ...state,
        phone: action.phone,
        isNewUser: action.isNewUser ?? state.isNewUser,
        userId: action.userId ?? state.userId,
        customerName: action.customerName ?? state.customerName,
        step: "otp",
        error: null,
      };
    }

    case "OTP_VERIFIED": {
      if (state.step !== "otp") return state;
      return {
        ...state,
        step: state.isNewUser ? "name" : "address",
        verificationToken: action.token,
        tokenExpiresAt: action.expiresAt,
        error: null,
      };
    }

    case "NAME_CONFIRMED": {
      if (state.step !== "name") return state;
      return { ...state, customerName: action.name, step: "address", error: null };
    }

    case "ORDER_CREATED": {
      return {
        ...state,
        step: "order-created",
        orderId: action.orderId,
        orderNumber: action.orderNumber,
        userId: action.userId,
        isNewUser: action.isNewUser,
        // The token is spent once the order exists — it only ever authorized
        // this creation (§4.3 purpose-scoped).
        verificationToken: null,
        tokenExpiresAt: null,
        error: null,
      };
    }

    case "BEGIN_GARMENTS":
      if (state.step !== "order-created" && state.step !== "review") return state;
      return { ...state, step: "garment-pick", error: null };

    case "ADD_ANOTHER_GARMENT":
      if (state.step !== "review") return state;
      return { ...state, step: "garment-pick", error: null };

    case "GARMENT_PICKED": {
      if (state.step !== "garment-pick") return state;
      return { ...state, step: "garment-config", error: null };
    }

    case "GARMENT_CONFIG_DONE": {
      if (state.step !== "garment-config") return state;
      return { ...state, step: "review", error: null };
    }

    case "EDIT_GARMENT": {
      if (state.step !== "review") return state;
      return { ...state, step: "garment-config", error: null };
    }

    case "QR_SHOWN": {
      if (state.step !== "review") return state;
      return { ...state, step: "wait", error: null };
    }

    case "REVIEW_NOW": {
      if (state.step !== "garment-pick" || !action.hasGarments) return state;
      return { ...state, step: "review", error: null };
    }

    // ── Step 4: manual Check Now (§5.6) ────────────────────────────────────
    case "CHECK_NOW_START": {
      if (state.step !== "wait" || state.checking) return state;
      return { ...state, checking: true, error: null };
    }

    case "CHECK_NOW_RESULT": {
      if (!state.checking) return state;
      if (action.fulfillmentStatus === "cancelled") {
        return { ...state, checking: false, step: "cancelled" };
      }
      return {
        ...state,
        checking: false,
        paid: action.ready,
        codSelected: action.codSelected,
        lastCheckedAt: action.now,
        error: null,
      };
    }

    case "CHECK_NOW_ERROR": {
      if (!state.checking) return state;
      return { ...state, checking: false, error: action.message };
    }

    case "MEASUREMENT_STARTED": {
      if (state.step !== "wait" || !state.paid) return state;
      return { ...state, step: "done", jobId: action.jobId, error: null };
    }

    case "WALKIN_CANCELLED": {
      if (state.step === "done" || state.step === "cancelled") return state;
      return { ...state, step: "cancelled", error: null };
    }

    case "TOKEN_EXPIRED": {
      if (state.step !== "otp" && state.step !== "name" && state.step !== "address") {
        return state;
      }
      return {
        ...state,
        step: "otp",
        verificationToken: null,
        tokenExpiresAt: null,
        error: "The code session expired — ask the customer for a new OTP.",
      };
    }

    case "GO_BACK": {
      const target = GO_BACK_STEPS[state.step];
      if (!target) return state;
      return { ...state, step: target, error: null };
    }

    case "RESUME": {
      const s = action.snapshot;
      return {
        ...state,
        step: resumeStep(s),
        phone: s.user.phone ?? state.phone,
        isNewUser: false,
        customerName: s.user.name,
        userId: s.user.id,
        verificationToken: null,
        tokenExpiresAt: null,
        addressId: s.address?.id ?? null,
        orderId: s.order_id,
        orderNumber: s.order_number,
        jobId: s.job_id,
        checking: false,
        paid: s.stage === "ready",
        codSelected: s.cod_selected,
        lastCheckedAt: null,
        error: null,
      };
    }

    case "RESET":
      return initialState();

    default:
      return state;
  }
}
