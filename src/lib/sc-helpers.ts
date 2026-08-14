/**
 * Shared helpers for the style-captain dashboard.
 */

import type { SCJob, SCMetric } from "@/lib/style-captain-api";

/** Format an ISO date for display; returns "—" if missing. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return iso;
  }
}

/** Format a date with day + full month + year. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

const STATUS_STYLES: Record<string, string> = {
  scheduled:
    "bg-orange-badge-bg text-accent-text border border-orange-highlight/40",
  in_progress: "bg-mist-navy text-ink-navy border border-navy-interactive/30",
  completed: "bg-success-bg text-success-text border border-success-border",
  cancelled: "bg-error-bg text-error-text border border-error-border",
};

export function statusBadgeClass(status: string | null | undefined): string {
  if (!status) return "bg-mist-navy text-muted border border-hairline";
  return STATUS_STYLES[status] ?? STATUS_STYLES["scheduled"];
}

export function humanStatus(status: string | null | undefined): string {
  if (!status) return "Unknown";
  return status
    .split("_")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

/** Pick the best available label from a multilingual labels dict. */
export function pickLabel(
  labels: Record<string, string> | null | undefined,
  fallback = "",
): string {
  if (!labels) return fallback;
  return labels.en ?? labels.hi ?? labels.kn ?? labels.ta ?? labels.te ?? Object.values(labels)[0] ?? fallback;
}

/** Pick the best available description from a multilingual descriptions dict. */
export function pickDescription(
  descriptions: Record<string, string> | null | undefined,
  fallback = "",
): string {
  if (!descriptions) return fallback;
  return (
    descriptions.en ??
    descriptions.hi ??
    descriptions.kn ??
    descriptions.ta ??
    descriptions.te ??
    Object.values(descriptions)[0] ??
    fallback
  );
}

/** Garment display name from labels / slug. */
export function garmentName(g: { labels: Record<string, string> | null; slug: string | null }): string {
  return pickLabel(g.labels, g.slug ?? "Garment");
}

/** Slot display helper. */
export function formatSlot(slot: Record<string, unknown> | null): string {
  if (!slot) return "—";
  const date = (slot.date as string) ?? null;
  const start = (slot.start as string) ?? null;
  const end = (slot.end as string) ?? null;
  const parts: string[] = [];
  if (date) parts.push(formatDate(date));
  if (start && end) parts.push(`${start}–${end}`);
  else if (start) parts.push(start);
  return parts.join(" · ") || "—";
}

/** Find a metric by id. */
export function findMetric(metrics: SCMetric[], id: string | null): SCMetric | null {
  if (!id) return null;
  return metrics.find((m) => m.id === id) ?? null;
}

/** Find the existing measurement value for a metric on a job.
 *
 *  garmentOrderId omitted/undefined → base reading (garment_order_id NULL).
 *  Pass a garment order id → that instance's reading. Note: `undefined`
 *  matches base-only; pass `null` explicitly to get any-scope fallback
 *  (legacy flat captures had no scope).
 */
export function existingValue(
  job: SCJob,
  metricId: string,
  garmentOrderId?: string,
): { numeric: number | null; text: string | null; unit: string | null } {
  const m = job.measurements.find((x) => {
    if (x.measurement_metric_id !== metricId) return false;
    if (garmentOrderId === undefined) return x.garment_order_id == null;
    return x.garment_order_id === garmentOrderId;
  });
  return {
    numeric: m?.value_numeric ?? null,
    text: m?.value_text ?? null,
    unit: m?.unit ?? null,
  };
}

/** Format address from a job's address fields. Returns null if no address. */
export function formatAddress(job: {
  address_line_1: string | null;
  address_line_2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
}): string | null {
  const parts: string[] = [];
  if (job.address_line_1) parts.push(job.address_line_1);
  if (job.address_line_2) parts.push(job.address_line_2);
  const cityStatePin = [
    job.city,
    job.state,
    job.pincode,
  ].filter(Boolean).join(", ");
  if (cityStatePin) parts.push(cityStatePin);
  return parts.length > 0 ? parts.join(", ") : null;
}

/** Build a Google Maps URL from address fields or coordinates. */
export function mapsUrl(job: {
  address_line_1: string | null;
  address_line_2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  coordinates: Record<string, unknown> | null;
}): string {
  // Prefer coordinates if available
  const coords = job.coordinates;
  if (coords) {
    const lat = (coords.lat as number | string | undefined) ?? (coords.latitude as number | string | undefined);
    const lng = (coords.lng as number | string | undefined) ?? (coords.longitude as number | string | undefined);
    if (lat != null && lng != null) {
      return `https://www.google.com/maps?q=${lat},${lng}`;
    }
  }
  // Fall back to address query
  const address = formatAddress(job);
  if (address) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
  }
  return "#";
}

/** Build a tel: link from a phone number + country code. */
export function telLink(job: {
  customer_phone: string | null;
  customer_country_code: string | null;
}): string | null {
  if (!job.customer_phone) return null;
  const cc = job.customer_country_code ?? "+91";
  return `tel:${cc}${job.customer_phone}`;
}

/** Get a display-ready phone string. */
export function formatPhone(job: {
  customer_phone: string | null;
  customer_country_code: string | null;
}): string {
  if (!job.customer_phone) return "—";
  const cc = job.customer_country_code ?? "+91";
  return `${cc} ${job.customer_phone}`;
}
