/**
 * Acquisition (UTM-style) attribution helpers.
 *
 * Two-level storage (industry first-touch + per-order split):
 *  - users.acquisition_*  → first-touch / original acquisition (write-once)
 *  - orders.acquisition_* → per-order attribution (last-touch for the order)
 *
 * The fields are free-text. The `options` chips are *suggestions*, not
 * constraints — an admin can type any value (e.g. a new campaign).
 */

export interface AcquisitionField {
  /** State-object key, e.g. "source". */
  key: AcquisitionKey;
  label: string;
  /** DB column name, e.g. "acquisition_source". */
  dbKey: AcquisitionDbKey;
  /** Suggested quick-pick values shown as Chip buttons. */
  options: readonly string[];
}

export type AcquisitionKey = "source" | "campaign" | "medium" | "term" | "content";

export type AcquisitionDbKey =
  | "acquisition_source"
  | "acquisition_campaign"
  | "acquisition_medium"
  | "acquisition_term"
  | "acquisition_content";

export const ACQUISITION_FIELDS: readonly AcquisitionField[] = [
  { key: "source", label: "Source", dbKey: "acquisition_source", options: ["on-ground", "instagram", "whatsapp"] },
  { key: "campaign", label: "Campaign", dbKey: "acquisition_campaign", options: ["hsr", "purva_skywood"] },
  { key: "medium", label: "Medium", dbKey: "acquisition_medium", options: ["group_forward", "shop_front", "door_to_door", "poster"] },
  { key: "term", label: "Term", dbKey: "acquisition_term", options: ["at_your_door_step", "precision_every_time", "koski", "g_block"] },
  { key: "content", label: "Content", dbKey: "acquisition_content", options: ["qr", "phone_number"] },
] as const;

/** Mutable state shape used by the capture forms. All strings (empty = unset). */
export type AcquisitionState = Record<AcquisitionKey, string>;

export function emptyAcquisition(): AcquisitionState {
  return { source: "", campaign: "", medium: "", term: "", content: "" };
}

/**
 * Build a DB payload from a capture-form state, **omitting empty fields** so
 * the DB stores NULL (not ""). Suitable for both `users` and `orders` writes.
 */
export function acquisitionPayload(
  state: AcquisitionState,
): Partial<Record<AcquisitionDbKey, string>> {
  const out: Partial<Record<AcquisitionDbKey, string>> = {};
  for (const f of ACQUISITION_FIELDS) {
    const v = state[f.key]?.trim();
    if (v) out[f.dbKey] = v;
  }
  return out;
}

/**
 * Inverse of acquisitionPayload: read a fetched row (user or order) back into
 * a capture-form state. Missing/null fields become "".
 */
export function acquisitionStateFromRow(
  row: Partial<Record<AcquisitionDbKey, string | null>> | null | undefined,
): AcquisitionState {
  const s = emptyAcquisition();
  if (!row) return s;
  for (const f of ACQUISITION_FIELDS) {
    const v = row[f.dbKey];
    s[f.key] = typeof v === "string" ? v : "";
  }
  return s;
}
