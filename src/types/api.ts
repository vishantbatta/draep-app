/**
 * API types — mirror backend Pydantic schemas (be/app/schemas/*.py).
 * All responses are JSON; errors use the { error: { code, message, details } } envelope.
 */

// ─── Common ───────────────────────────────────────────────────────────────────

export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
}

// ─── Auth (be/app/schemas/auth.py) ────────────────────────────────────────────

export interface AnonymousSessionOut {
  session_token: string;
  session_type: "anonymous";
  expires_at: string; // ISO datetime
}

export interface OtpSendOut {
  phone: string;
  country_code: string;
  expires_in_seconds: number;
  next_step: string;
}

export interface UserOut {
  id: string;
  phone: string | null;
  country_code: string | null;
  name: string | null;
  email: string | null;
  is_new_user: boolean;
}

export interface OtpVerifyOut {
  session_token: string;
  session_type: "user";
  user: UserOut;
  active_order_id: string | null;
  expires_at: string;
}

export interface SessionOut {
  session_type: "anonymous" | "user";
  user: UserOut | null;
  active_order_id: string | null;
}

// ─── Catalog (be/app/schemas/catalog.py) ──────────────────────────────────────

export interface VariationTypeOut {
  id: string;
  labels: Record<string, string> | null;
  descriptions: Record<string, string> | null;
  asset_urls: string[] | null;
  priority_order: number | null;
  ideal_for: string[] | null;
  not_ideal_for: string[] | null;
  price: number | null;
}

export interface VariationOut {
  id: string;
  labels: Record<string, string> | null;
  descriptions: Record<string, string> | null;
  asset_urls: string[] | null;
  priority_order: number | null;
  ideal_for: string[] | null;
  not_ideal_for: string[] | null;
  price: number | null;
  default_type_id: string | null;
  variation_types: VariationTypeOut[];
}

export interface ComponentOut {
  id: string;
  labels: Record<string, string> | null;
  descriptions: Record<string, string> | null;
  asset_urls: string[] | null;
  priority_order: number | null;
  importance: string | null;
  default_variation_id: string | null;
  variations: VariationOut[];
}

export interface AddonVariationOut {
  id: string;
  labels: Record<string, string> | null;
  descriptions: Record<string, string> | null;
  asset_urls: string[] | null;
  priority_order: number | null;
  style: string | null;
  shape: string | null;
  size: string | null;
  type: string | null;
  color: string | null;
  price: number | null;
}

export interface AddonOut {
  id: string;
  labels: Record<string, string> | null;
  descriptions: Record<string, string> | null;
  asset_urls: string[] | null;
  priority_order: number | null;
  type: string | null;
  garment_style_component_ids: string[] | null;
  placements: string[] | null;
  is_default_on: boolean | null;
  default_variation_id: string | null;
  price: number | null;
  variations: AddonVariationOut[];
}

export interface GarmentTreeOut {
  id: string;
  slug: string | null;
  labels: Record<string, string> | null;
  descriptions: Record<string, string> | null;
  asset_urls: string[] | null;
  gender: string | null;
  base_price: number | null;
  components: ComponentOut[];
  addons: AddonOut[];
}

export interface GarmentListItem {
  id: string;
  slug: string | null;
  labels: Record<string, string> | null;
  asset_urls: string[] | null;
  gender: string | null;
  base_price: number | null;
}

export interface GarmentListOut {
  items: GarmentListItem[];
}

// ─── Order (be/app/schemas/order.py) ──────────────────────────────────────────

export interface PriceLineOut {
  label: Record<string, string>;
  amount: number;
}

export interface PriceBreakdownOut {
  base_price: number;
  lines: PriceLineOut[];
  total: number;
}

export interface SelectionOut {
  component_id: string;
  variation_id: string | null;
  variation_type_id: string | null;
  label: Record<string, string> | null;
  price: number | null;
}

export interface AddOnStateOut {
  add_on_id: string;
  add_on_variation_id: string | null;
  placement: string | null;
  label: Record<string, string> | null;
  price: number | null;
}

export interface OrderOut {
  id: string;
  garment_id: string | null;
  payment_status: string | null;
  fulfillment_status: string | null;
  selections: SelectionOut[];
  add_on_states: AddOnStateOut[];
  price_breakdown: PriceBreakdownOut | null;
  contact: Record<string, unknown> | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface ValidationIssue {
  code: string;
  message: string;
  component_id: string | null;
}

export interface ValidateOut {
  valid: boolean;
  issues: ValidationIssue[];
}

// ─── Checkout (be/app/schemas/order.py — checkout section) ────────────────────

export interface CashfreeOut {
  order_id: string | null;
  order_amount: number | null;
  order_currency: string;
  payment_session_id: string | null;
  environment: string;
}

export interface CheckoutOut {
  order_id: string;
  order_number: string | null;
  payment_status: string | null;
  fulfillment_status: string | null;
  total_price: number | null;
  amount_due_now: number | null;
  amount_balance_on_delivery: number | null;
  cashfree: CashfreeOut | null;
}

export interface CheckoutVerifyOut {
  order_id: string;
  payment_status: string | null;
  fulfillment_status: string | null;
  balance_due: number | null;
}

export interface OrderStatusOut {
  payment_status: string | null;
  fulfillment_status: string | null;
  balance_due: number | null;
}

// ─── Pricing (be/app/schemas/pricing.py) ──────────────────────────────────────

export interface PricingSelectionIn {
  component_id: string;
  variation_id: string;
  variation_type_id?: string | null;
}

export interface PricingAddonIn {
  add_on_id: string;
  add_on_variation_id?: string | null;
  placement?: string | null;
}

export interface PricingComputeIn {
  garment_id: string;
  selections: PricingSelectionIn[];
  add_on_states: PricingAddonIn[];
}

// ─── Service Area (be/app/schemas/service_area.py) ────────────────────────────

export interface PolygonCorner {
  lat: number;
  lng: number;
}

export interface ServiceAreaShapeOut {
  polygon: PolygonCorner[];
  label: Record<string, string>;
}

export interface ServiceAreaCheckOut {
  serviceable: boolean;
  city: string | null;
  reason: string | null;
}

// ─── Request bodies ───────────────────────────────────────────────────────────

export interface ContactUpdateIn {
  name?: string;
  email?: string;
  address_line_1: string;
  address_line_2?: string;
  city: string;
  state: string;
  pincode: string;
  lat: number;
  lng: number;
}

export interface CheckoutIn {
  advance_policy: "advance_only" | "full";
}

export interface CheckoutVerifyIn {
  cashfree_order_id: string;
  cashfree_payment_id: string;
  cashfree_signature: string;
}
