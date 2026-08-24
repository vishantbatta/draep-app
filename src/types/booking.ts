/**
 * Draep booking types — mirror Frontend Spec §7 (catalog) and §8 (draft).
 */

export type Group =
  | "critical"
  | "fit"
  | "addon_material"
  | "addon_style";

export interface SubOption {
  id: string;
  label: string;
}

export interface StyleOption {
  id: string;
  label: string;
  priceKey?: string;
  subOptions?: SubOption[];
}

export interface Category {
  id: string;
  label: string;
  group: Group;
  route: string;
  defaultOptionId: string | null;
  options: StyleOption[];
}

export type AddOnKind = "toggle" | "choice" | "placements";

export interface AddOn {
  id: string;
  label: string;
  kind: AddOnKind;
  group: "addon_material" | "addon_style";
  priceKey?: string;
  choices?: SubOption[];
  placements?: SubOption[];
  perPlacementSizes?: SubOption[];
  extraInput?: { id: string; label: string; type: "text" };
  contextRoutes?: string[];
  caption?: string;
}

export interface Selection {
  optionId: string;
  subOptionId?: string;
}

export interface AddOnState {
  enabled: boolean;
  choiceId?: string;
  placements?: Record<string, { sizeId?: string }>;
  extraInputs?: Record<string, string>;
}

export interface ContactDetails {
  phone: string;
  name: string;
  address1: string;
  address2?: string;
  pincode: string;
  lat?: number;
  lng?: number;
}

export type PaymentStatus = "pending" | "paid" | "failed";

export interface PaymentState {
  orderId?: string;
  status: PaymentStatus;
}

export interface SlotSelection {
  date: string; // ISO yyyy-mm-dd
  window: string; // e.g. "18:00-21:00"
}

// ─── Booking API types (mirror be/app/api/booking.py schemas) ───────────────

/**
 * A single bookable slot. `start_at` is the canonical ISO instant — the FE
 * echoes it back on POST /booking verbatim. `label` is for display only.
 * Never reconstruct an instant on the client from a wall-clock string.
 */
export interface SlotOption {
  start_at: string; // ISO datetime, e.g. "2026-07-28T04:30:00Z"
  label: string; // "HH:MM" in the project scheduling zone, e.g. "10:00"
}

/** GET /orders/{id}/slots → a single day's available times. */
export interface DaySlots {
  date: string; // ISO yyyy-mm-dd
  slots: SlotOption[];
}

/** GET /orders/{id}/slots response. */
export interface SlotsResponse {
  days: DaySlots[];
}

/** POST/PATCH /orders/{id}/booking response. */
export interface Booking {
  job_id: string;
  /** Null while the booking is a draft hold — no captain until promotion. */
  captain_id: string | null;
  captain_name: string | null;
  scheduled_at: string; // ISO datetime
  status: "draft" | "scheduled" | "in_progress" | "needs_reassignment";
}

export interface BookingDraft {
  version: 1;
  /** Server-side order ID — null until POST /orders succeeds. */
  orderId: string | null;
  /** Garment ID from catalog — set on draft init. */
  garmentId: string | null;
  /**
   * Set when this draft was created from a library design via
   * POST /library/:id/draft-order. Used to badge the design attribution
   * on the review screen and to short-circuit re-tapping the same design.
   */
  libraryId?: string | null;
  selections: Record<string, Selection>; // keyed by Category.id
  addOns: Record<string, AddOnState>;
  contact?: ContactDetails;
  payment?: PaymentState;
  /**
   * Server-side booking (POST /orders/{id}/booking response). Captured on
   * /schedule BEFORE payment so the /confirmed success screen can render
   * the visit summary without another round-trip.
   */
  booking?: Booking;
  /** Server-side price breakdown (from last order fetch or pricing compute). */
  serverPriceBreakdown?: {
    base: number;
    lines: { label: string; amount: number }[];
    total: number;
  } | null;
  updatedAt: string; // ISO
}

export interface PriceLine {
  label: string;
  amount: number;
}

export interface PriceComputation {
  base: number;
  lines: PriceLine[];
  total: number;
}
