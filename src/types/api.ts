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
  slug: string | null;
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
  /** placement-specific pricing axis; null = applies at every placement */
  placement: string | null;
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
  /**
   * Provenance (Design Library spec C4):
   *   - `library_default`  copied from a library design via /library/:id/draft-order
   *   - `user_modified`    user changed this row via review-screen PUT/PATCH/DELETE
   *   - `custom`           added by the from-scratch configurator (default)
   */
  source: "library_default" | "user_modified" | "custom" | null;
}

export interface AddOnStateOut {
  add_on_id: string;
  add_on_variation_id: string | null;
  /**
   * Placement is now always a JSONB array on the wire (Design Library spec F7).
   * Backend normalizes single-string inputs to a 1-element array; older code
   * that passes a scalar string still works through the PUT endpoint.
   * NULL only when placement doesn't apply (Piping, Boning, Breast cups, etc.).
   */
  placement: string[] | null;
  label: Record<string, string> | null;
  price: number | null;
  source: "library_default" | "user_modified" | "custom" | null;
}

export interface OrderOut {
  id: string;
  garment_id: string | null;
  /** Set when this order was drafted from a library design. */
  library_id: string | null;
  payment_status: string | null;
  fulfillment_status: string | null;
  selections: SelectionOut[];
  add_on_states: AddOnStateOut[];
  price_breakdown: PriceBreakdownOut | null;
  contact: Record<string, unknown> | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface OrderListItem {
  id: string;
  order_number: string | null;
  /** First garment order's garment — powers "re-order" on the dashboard. */
  garment_id: string | null;
  library_id: string | null;
  /** English labels of every garment in the order, in sequence. */
  garments: string[];
  payment_status: string | null;
  fulfillment_status: string | null;
  total_price: number | null;
  slot: Record<string, unknown> | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface OrderListOut {
  items: OrderListItem[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

/** One resolved selection/add-on row on the order detail page. */
export interface OrderDetailItem {
  type: "selection" | "add_on" | null;
  /** Component / add-on name, e.g. "Sleeve style". */
  label: string | null;
  /** Chosen variation / variant, e.g. "Regular short". */
  value: string | null;
  placement: string[] | null;
  price: number | null;
  custom_input: Record<string, unknown> | null;
  source: string | null;
}

export interface OrderDetailGarmentOrder {
  id: string;
  garment_id: string | null;
  garment_label: string | null;
  library_id: string | null;
  status: string | null;
  user_note: string | null;
  base_price: number | null;
  /** Additive total: base + priced items + scoped adjustments (invoice math). */
  total_price: number | null;
  items: OrderDetailItem[];
}

export interface OrderDetailAdjustment {
  label: string | null;
  type: string | null; // discount | fee
  amount: number;
}

export interface OrderTransaction {
  id: string;
  type: string | null; // payment | refund
  amount: number | null;
  status: string | null;
  provider: string | null;
  method: string | null;
  captured_at: string | null;
  refunded_at: string | null;
  created_at: string | null;
}

/** One style-captain measurement visit tied to the order. */
export interface OrderMeasurementJob {
  id: string;
  status: string | null; // scheduled | in_progress | completed | cancelled | needs_reassignment
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  notes: string | null;
  captain_name: string | null;
}

export interface CustomerOrderDetail {
  id: string;
  order_number: string | null;
  payment_status: string | null;
  fulfillment_status: string | null;
  total_price: number | null;
  paid_amount: number;
  balance_due: number;
  slot: Record<string, unknown> | null;
  contact: Record<string, unknown> | null;
  measurement_jobs: OrderMeasurementJob[];
  created_at: string | null;
  updated_at: string | null;
  garment_orders: OrderDetailGarmentOrder[];
  adjustments: OrderDetailAdjustment[];
  transactions: OrderTransaction[];
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

// ─── Design Library (be/app/schemas/design_library.py) ────────────────────────

/** A localized label wrapper — same shape the BE uses for component/addon labels. */
export interface LabelOut {
  id: string;
  label: Record<string, string> | null;
}

/** One card in the browse grid (GET /library). */
export interface LibraryListItemOut {
  id: string;
  labels: Record<string, string> | null;
  descriptions: Record<string, string> | null;
  category: string | null;
  celebrity_name: string | null;
  famous_for: Record<string, string> | null;
  occasions: string[] | null;
  hero_image_url: string | null;
  /** As-configured price (live). Not a "from" — honest total. */
  price: number;
}

export interface LibraryListOut {
  items: LibraryListItemOut[];
  next_cursor: string | null;
}

/** Flat self-describing item, same shape for library and order review. */
export interface ResolvedItemOut {
  item_id: string;
  type: "variation" | "add_on";
  component: LabelOut | null;
  variation: LabelOut | null;
  variation_type: LabelOut | null;
  add_on: LabelOut | null;
  add_on_variation: LabelOut | null;
  placement: string[];
  price: number | null;
  /** Only present for order-review items; absent on library-detail items. */
  source: "library_default" | "user_modified" | "custom" | null;
}

/** Full design detail (GET /library/:id). */
export interface LibraryDetailOut {
  id: string;
  garment_id: string | null;
  labels: Record<string, string> | null;
  descriptions: Record<string, string> | null;
  category: string | null;
  celebrity_name: string | null;
  famous_for: Record<string, string> | null;
  reference_url: string | null;
  occasions: string[] | null;
  styling_notes: Record<string, string> | null;
  hero_image_url: string | null;
  front_image_url: string | null;
  back_image_url: string | null;
  side_image_url: string | null;
  items: ResolvedItemOut[];
  price: number;
}

/** Returned by POST /library/:id/draft-order. */
export interface DraftFromLibraryOut {
  order_id: string;
  library_id: string;
  /** Full serialized draft order — same shape as OrderOut, so the FE can
   *  reuse its existing reconcile logic verbatim. */
  order: OrderOut;
}

/** Query params for GET /library. */
export interface LibraryListParams {
  occasion?: string[];
  category?: string[];
  celebrity?: string[];
  limit?: number;
  cursor?: string;
}
