/**
 * Shared display helpers for customer order surfaces (/app dashboard +
 * order detail page).
 */

/** Human order reference: order number when assigned, else a short id.
 *  Legacy "DRP-"/"WALKIN-" prefixes are stripped — customers see the bare
 *  number (new orders are 11 bare digits already). */
export function displayOrderNumber(orderNumber: string | null, id: string): string {
  return (orderNumber ?? id.slice(0, 8)).replace(/^(?:DRP|WALKIN)-/i, "");
}

export function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** The order.slot snapshot is a JSON dict; be defensive about its shape. */
export function slotVisitLabel(slot: Record<string, unknown> | null): string | null {
  if (!slot) return null;
  const raw = slot.scheduled_at ?? slot.starts_at;
  if (typeof raw !== "string") return null;
  return visitDateTimeLabel(raw);
}

/** "Monday, 17 Aug, 3:15 PM" from a raw ISO datetime string. */
export function visitDateTimeLabel(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "short",
  });
  const time = d.toLocaleTimeString("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${day}, ${time}`;
}
