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

export interface BookingDraft {
  version: 1;
  /** Server-side order ID — null until POST /orders succeeds. */
  orderId: string | null;
  /** Garment ID from catalog — set on draft init. */
  garmentId: string | null;
  selections: Record<string, Selection>; // keyed by Category.id
  addOns: Record<string, AddOnState>;
  contact?: ContactDetails;
  payment?: PaymentState;
  slot?: SlotSelection;
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
