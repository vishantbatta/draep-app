/**
 * Walk-in review phase — the pure state behind the review screen's
 * conditional sticky CTA (spec: slot-first flow).
 *
 *  choose-slot    no slot/job yet → CTA: Measure Now | Schedule Later
 *  check-payment  a slot/job exists (drafted, scheduled, or measured-now)
 *                 but payment isn't confirmed → CTA: Check for Payment
 *  confirmation   slot drafted for later + payment confirmed → order
 *                 confirmation view (no CTA)
 *  done           job in progress (measured now) + payment confirmed →
 *                 open the job per the current flow (no CTA)
 */
import { describe, expect, it } from "vitest";

import { walkInReviewPhase } from "../walkin-review";

const job = (status: string, scheduledAt?: string) =>
  scheduledAt ? { id: "j", status, scheduled_at: scheduledAt, captain_name: null } : { id: "j", status, scheduled_at: null, captain_name: null };

describe("walkInReviewPhase", () => {
  it("no job → choose-slot (Measure Now | Schedule Later)", () => {
    expect(walkInReviewPhase({ job: null, paymentReady: false })).toBe("choose-slot");
    // even if somehow already paid — the slot decision still comes first
    expect(walkInReviewPhase({ job: null, paymentReady: true })).toBe("choose-slot");
  });

  it("drafted/scheduled slot, unpaid → check-payment", () => {
    expect(
      walkInReviewPhase({ job: job("draft", "2099-01-01T04:30:00Z"), paymentReady: false }),
    ).toBe("check-payment");
    expect(
      walkInReviewPhase({ job: job("scheduled", "2099-01-01T04:30:00Z"), paymentReady: false }),
    ).toBe("check-payment");
  });

  it("drafted/scheduled slot, paid → confirmation (later visit: just confirm)", () => {
    expect(
      walkInReviewPhase({ job: job("draft", "2099-01-01T04:30:00Z"), paymentReady: true }),
    ).toBe("confirmation");
    expect(
      walkInReviewPhase({ job: job("scheduled", "2099-01-01T04:30:00Z"), paymentReady: true }),
    ).toBe("confirmation");
  });

  it("in-progress job (Measure Now), unpaid → check-payment", () => {
    expect(walkInReviewPhase({ job: job("in_progress"), paymentReady: false })).toBe(
      "check-payment",
    );
  });

  it("paid draft (booking handled server-side) → confirmation", () => {
    expect(
      walkInReviewPhase({ job: job("draft", "2099-01-01T04:30:00Z"), paymentReady: true }),
    ).toBe("confirmation");
  });

  it("in-progress job, paid → done (open the job)", () => {
    expect(walkInReviewPhase({ job: job("in_progress"), paymentReady: true })).toBe("done");
  });
});
