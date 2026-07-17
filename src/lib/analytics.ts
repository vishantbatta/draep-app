/**
 * Analytics stub — emits structured events to console in V0.
 * TODO: wire to a real provider before launch. Spec §12 lists the events.
 */

export type AnalyticsEvent =
  | { event: "landing_cta_tapped"; resumed: boolean }
  | { event: "design_step_viewed"; stepId: string }
  | {
      event: "option_changed";
      categoryId: string;
      from: string | null;
      to: string;
      subOptionId?: string;
    }
  | { event: "addon_toggled"; addOnId: string; enabled: boolean; source: "context" | "addons_screen" | "review_sheet" }
  | { event: "design_completed_default_count"; defaultCount: number }
  | { event: "review_viewed" }
  | { event: "review_row_edited"; rowId: string }
  | { event: "contact_submitted" }
  | { event: "serviceability_failed"; areaResult: string }
  | {
      event: "payment_initiated" | "payment_succeeded" | "payment_failed";
      orderId: string;
      amount: number;
    }
  | { event: "slot_selected"; date: string; window: string };

export function track(event: AnalyticsEvent): void {
  if (typeof window === "undefined") return;
  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.debug("[analytics]", event);
  }
  // TODO: forward to real provider.
}
