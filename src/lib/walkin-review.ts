/**
 * Walk-in review phase — pure derivation for the review screen's
 * conditional sticky CTA. See __tests__/walkin-review.test.ts for the spec.
 */

export type WalkInReviewPhase = "choose-slot" | "check-payment" | "confirmation" | "done";

export function walkInReviewPhase(input: {
  job: { status: string | null } | null;
  paymentReady: boolean;
}): WalkInReviewPhase {
  const job = input.job;
  if (!job) return "choose-slot";
  if (job.status === "in_progress") return input.paymentReady ? "done" : "check-payment";
  // drafted / scheduled — payment done means the visit is booked/confirmed
  // (a paid draft that couldn't be booked still shows as confirmed — admin
  // resolves the hold), unpaid means the check gates it.
  return input.paymentReady ? "confirmation" : "check-payment";
}
