/**
 * Order status display — shared by the /app dashboard cards and the
 * /app/orders/[id] detail page.
 *
 * Payment and fulfilment are always rendered as SEPARATE, labelled rows —
 * two unlabeled chips side by side read as noise.
 */

import { strings } from "@/lib/strings";

const PAYMENT_PILL: Record<string, string> = {
  paid: "bg-success-bg text-success-text",
  captured: "bg-success-bg text-success-text",
  partial: "bg-warning-bg text-warning-text",
  partially_paid: "bg-warning-bg text-warning-text",
  pending: "bg-warning-bg text-warning-text",
  failed: "bg-error-bg text-error-text",
  refunded: "bg-warning-bg text-warning-text",
  partially_refunded: "bg-warning-bg text-warning-text",
};

const FULFILLMENT_PILL: Record<string, string> = {
  confirmed: "bg-success-bg text-success-text",
  scheduled: "bg-success-bg text-success-text",
  in_progress: "bg-mist-navy text-ink-navy",
  stitched: "bg-success-bg text-success-text",
  delivered: "bg-success-bg text-success-text",
  cancelled: "bg-error-bg text-error-text",
  // measurement-visit states (shared with the job card on the order page)
  completed: "bg-success-bg text-success-text",
  needs_reassignment: "bg-warning-bg text-warning-text",
};

function humanStatus(status: string): string {
  return status.replace(/_/g, " ");
}

export function StatusPill({
  status,
  kind,
}: {
  status: string;
  kind: "payment" | "fulfillment";
}) {
  const palette = kind === "payment" ? PAYMENT_PILL : FULFILLMENT_PILL;
  const cls = palette[status] ?? "bg-mist-navy text-ink-navy";
  return (
    <span
      className={`rounded-pill px-2.5 py-0.5 text-caption font-semibold capitalize ${cls}`}
    >
      {humanStatus(status)}
    </span>
  );
}

/** Fulfilment status + payment status, each on its own labelled row. */
export function OrderStatusRows({
  fulfillmentStatus,
  paymentStatus,
}: {
  fulfillmentStatus: string | null | undefined;
  paymentStatus: string | null | undefined;
}) {
  return (
    <div className="space-y-2">
      {fulfillmentStatus && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-caption text-muted">
            {strings.orderDetail.fulfillmentLabel}
          </span>
          <StatusPill status={fulfillmentStatus} kind="fulfillment" />
        </div>
      )}
      {paymentStatus && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-caption text-muted">
            {strings.orderDetail.paymentLabel}
          </span>
          <StatusPill status={paymentStatus} kind="payment" />
        </div>
      )}
    </div>
  );
}

/** Compact one-line variant for dashboard cards: short label + pill pairs. */
export function OrderStatusPills({
  fulfillmentStatus,
  paymentStatus,
}: {
  fulfillmentStatus: string | null | undefined;
  paymentStatus: string | null | undefined;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {fulfillmentStatus && (
        <span className="flex items-center gap-1.5">
          <span className="text-caption text-muted">
            {strings.orderDetail.fulfillmentShort}
          </span>
          <StatusPill status={fulfillmentStatus} kind="fulfillment" />
        </span>
      )}
      {paymentStatus && (
        <span className="flex items-center gap-1.5">
          <span className="text-caption text-muted">
            {strings.orderDetail.paymentShort}
          </span>
          <StatusPill status={paymentStatus} kind="payment" />
        </span>
      )}
    </div>
  );
}
