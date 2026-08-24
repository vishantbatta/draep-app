/**
 * Admin API client — thin wrapper around fetch.
 * Reads the JWT from localStorage and injects the Authorization header.
 */

// Relative so all calls are same-origin (proxied to backend via next.config.mjs
// rewrites — eliminates all CORS issues).
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "/api/v1";
const TOKEN_KEY = "draep_admin_token";

export function getAdminToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setAdminToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearAdminToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export interface AdminTableData {
  table: string;
  columns: string[];
  rows: Record<string, unknown>[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

async function adminFetch<T>(path: string, options?: RequestInit & { auth?: boolean }): Promise<T> {
  const { auth = true, headers = {}, ...rest } = options ?? {};
  const finalHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...(headers as Record<string, string>),
  };

  if (auth) {
    const token = getAdminToken();
    if (!token) throw new Error("No admin token");
    finalHeaders["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_URL}${path}`, {
    ...rest,
    headers: finalHeaders,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let message = `Request failed (${res.status})`;
    if (text) {
      try {
        const body = JSON.parse(text) as { error?: { message?: string } };
        message = body?.error?.message ?? message;
      } catch {
        // Non-JSON error body — keep default message
      }
    }
    throw new Error(message);
  }

  // 204 No Content (or any empty body) — nothing to parse.
  if (res.status === 204) {
    return undefined as T;
  }
  const text = await res.text();
  if (!text) {
    return undefined as T;
  }
  return JSON.parse(text) as T;
}

export async function adminLogin(email: string, password: string): Promise<string> {
  const data = await adminFetch<{ token: string }>("/admin/login", {
    method: "POST",
    auth: false,
    body: JSON.stringify({ email, password }),
  });
  return data.token;
}

export interface UserLoginLink {
  token: string;
  expires_at: string; // ISO datetime
}

/** Mint a short-lived login-link token for a user (admin impersonation). */
export async function createUserLoginLink(userId: string): Promise<UserLoginLink> {
  return adminFetch<UserLoginLink>(`/admin/users/${userId}/login-link`, {
    method: "POST",
  });
}

export async function fetchTables(): Promise<string[]> {
  const data = await adminFetch<{ tables: string[] }>("/admin/tables");
  return data.tables;
}

// ─── Sort types ──────────────────────────────────────────────────────────────

export type SortDirection = "asc" | "desc";

export interface SortState {
  column: string | null;
  direction: SortDirection;
}

// ─── Filter types ────────────────────────────────────────────────────────────

export type FilterOp = "eq" | "contains" | "not_contains" | "gt" | "lt";

export const FILTER_LABELS: Record<FilterOp, string> = {
  eq: "equals",
  contains: "contains",
  not_contains: "does not contain",
  gt: "greater than",
  lt: "less than",
};

export interface FilterCondition {
  type: "filter";
  column: string;
  op: FilterOp;
  value: string;
}

export interface FilterGroup {
  type: "group";
  logic: "and" | "or";
  children: FilterNode[];
}

export type FilterNode = FilterCondition | FilterGroup;

// ─── Helpers for building filter trees ───────────────────────────────────────

let _idCounter = 0;
export function nextId(): string {
  _idCounter += 1;
  return `n${_idCounter}`;
}

export function createCondition(column: string): FilterCondition {
  return { type: "filter", column, op: "eq", value: "", id: nextId() } as FilterCondition & { id: string };
}

export function createGroup(logic: "and" | "or" = "and"): FilterGroup {
  return { type: "group", logic, children: [], id: nextId() } as FilterGroup & { id: string };
}

// ─── Fetch with sort + filters ───────────────────────────────────────────────

export async function fetchTableData(
  table: string,
  page: number,
  perPage: number = 20,
  sort?: SortState,
  filters?: FilterNode | null,
): Promise<AdminTableData> {
  const params = new URLSearchParams({ page: String(page), per_page: String(perPage) });
  if (sort?.column) {
    params.set("sort_column", sort.column);
    params.set("sort_direction", sort.direction);
  }
  if (filters) {
    // Strip transient `id` fields before sending
    const clean = stripIds(filters);
    params.set("filters", JSON.stringify(clean));
  }
  return adminFetch<AdminTableData>(`/admin/tables/${table}?${params}`);
}

function stripIds(node: FilterNode): FilterNode {
  if (node.type === "filter") {
    const { ...rest } = node;
    return { type: "filter", column: rest.column, op: rest.op, value: rest.value };
  }
  return {
    type: "group",
    logic: node.logic,
    children: node.children.map(stripIds),
  };
}

// ─── Garment types + helpers ─────────────────────────────────────────────────

export interface Garment {
  id: string;
  slug: string | null;
  labels: Record<string, string> | null;
  descriptions: Record<string, string> | null;
  asset_urls: string[] | null;
  gender: string | null;
  base_price: number | null;
}

export interface GarmentCreateInput {
  slug: string;
  labels?: Record<string, string> | null;
  descriptions?: Record<string, string> | null;
  asset_urls?: string[] | null;
  gender?: string | null;
  base_price?: number | null;
}

export interface GarmentUpdateInput {
  slug?: string;
  labels?: Record<string, string> | null;
  descriptions?: Record<string, string> | null;
  asset_urls?: string[] | null;
  gender?: string | null;
  base_price?: number | null;
}

export async function createGarment(input: GarmentCreateInput): Promise<Garment> {
  return adminFetch<Garment>("/admin/garments", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateGarment(id: string, input: GarmentUpdateInput): Promise<Garment> {
  return adminFetch<Garment>(`/admin/garments/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function deleteGarment(id: string): Promise<void> {
  await adminFetch<void>(`/admin/garments/${id}`, { method: "DELETE" });
}

// ─── Garment Style Component types + helpers ─────────────────────────────────

export interface StyleComponent {
  id: string;
  slug: string | null;
  garment_id: string | null;
  priority_order: number | null;
  labels: Record<string, string> | null;
  descriptions: Record<string, string> | null;
  asset_urls: string[] | null;
  importance: string | null;
  default_variation_id: string | null;
}

export interface StyleComponentCreateInput {
  slug: string;
  garment_id?: string | null;
  priority_order?: number | null;
  labels?: Record<string, string> | null;
  descriptions?: Record<string, string> | null;
  asset_urls?: string[] | null;
  importance?: string | null;
  default_variation_id?: string | null;
}

export interface StyleComponentUpdateInput {
  slug?: string;
  garment_id?: string | null;
  priority_order?: number | null;
  labels?: Record<string, string> | null;
  descriptions?: Record<string, string> | null;
  asset_urls?: string[] | null;
  importance?: string | null;
  default_variation_id?: string | null;
}

export async function createStyleComponent(input: StyleComponentCreateInput): Promise<StyleComponent> {
  return adminFetch<StyleComponent>("/admin/garment_style_components", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateStyleComponent(id: string, input: StyleComponentUpdateInput): Promise<StyleComponent> {
  return adminFetch<StyleComponent>(`/admin/garment_style_components/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function deleteStyleComponent(id: string): Promise<void> {
  await adminFetch<void>(`/admin/garment_style_components/${id}`, { method: "DELETE" });
}

// ─── Garment Style Component Variation types + helpers ────────────────────────

export interface Variation {
  id: string;
  slug: string | null;
  component_id: string | null;
  priority_order: number | null;
  labels: Record<string, string> | null;
  descriptions: Record<string, string> | null;
  asset_urls: string[] | null;
  ideal_for: string[] | null;
  not_ideal_for: string[] | null;
  price: number | null;
  default_type_id: string | null;
}

export interface VariationCreateInput {
  slug: string;
  component_id?: string | null;
  priority_order?: number | null;
  labels?: Record<string, string> | null;
  descriptions?: Record<string, string> | null;
  asset_urls?: string[] | null;
  ideal_for?: string[] | null;
  not_ideal_for?: string[] | null;
  price?: number | null;
  default_type_id?: string | null;
}

export interface VariationUpdateInput {
  slug?: string;
  component_id?: string | null;
  priority_order?: number | null;
  labels?: Record<string, string> | null;
  descriptions?: Record<string, string> | null;
  asset_urls?: string[] | null;
  ideal_for?: string[] | null;
  not_ideal_for?: string[] | null;
  price?: number | null;
  default_type_id?: string | null;
}

export async function createVariation(input: VariationCreateInput): Promise<Variation> {
  return adminFetch<Variation>("/admin/garment_style_component_variations", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateVariation(id: string, input: VariationUpdateInput): Promise<Variation> {
  return adminFetch<Variation>(`/admin/garment_style_component_variations/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function deleteVariation(id: string): Promise<void> {
  await adminFetch<void>(`/admin/garment_style_component_variations/${id}`, { method: "DELETE" });
}

// ─── Garment Style Component Variation Type types + helpers ──────────────────

export interface VariationType {
  id: string;
  slug: string | null;
  variation_id: string | null;
  priority_order: number | null;
  labels: Record<string, string> | null;
  descriptions: Record<string, string> | null;
  asset_urls: string[] | null;
  ideal_for: string[] | null;
  not_ideal_for: string[] | null;
  price: number | null;
}

export interface VariationTypeCreateInput {
  slug: string;
  variation_id?: string | null;
  priority_order?: number | null;
  labels?: Record<string, string> | null;
  descriptions?: Record<string, string> | null;
  asset_urls?: string[] | null;
  ideal_for?: string[] | null;
  not_ideal_for?: string[] | null;
  price?: number | null;
}

export interface VariationTypeUpdateInput {
  slug?: string;
  variation_id?: string | null;
  priority_order?: number | null;
  labels?: Record<string, string> | null;
  descriptions?: Record<string, string> | null;
  asset_urls?: string[] | null;
  ideal_for?: string[] | null;
  not_ideal_for?: string[] | null;
  price?: number | null;
}

export async function createVariationType(input: VariationTypeCreateInput): Promise<VariationType> {
  return adminFetch<VariationType>("/admin/garment_style_component_variation_types", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateVariationType(id: string, input: VariationTypeUpdateInput): Promise<VariationType> {
  return adminFetch<VariationType>(`/admin/garment_style_component_variation_types/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function deleteVariationType(id: string): Promise<void> {
  await adminFetch<void>(`/admin/garment_style_component_variation_types/${id}`, { method: "DELETE" });
}

// ─── Garment Add-on types + helpers ──────────────────────────────────────────

export interface Addon {
  id: string;
  slug: string | null;
  garment_id: string | null;
  priority_order: number | null;
  labels: Record<string, string> | null;
  descriptions: Record<string, string> | null;
  asset_urls: string[] | null;
  garment_style_component_ids: string[] | null;
  type: string | null;
  placements: string[] | null;
  default_variation_id: string | null;
  is_default_on: boolean | null;
  price: number | null;
}

export interface AddonCreateInput {
  slug: string;
  garment_id?: string | null;
  priority_order?: number | null;
  labels?: Record<string, string> | null;
  descriptions?: Record<string, string> | null;
  asset_urls?: string[] | null;
  garment_style_component_ids?: string[] | null;
  type?: string | null;
  placements?: string[] | null;
  default_variation_id?: string | null;
  is_default_on?: boolean | null;
  price?: number | null;
}

export interface AddonUpdateInput {
  slug?: string;
  garment_id?: string | null;
  priority_order?: number | null;
  labels?: Record<string, string> | null;
  descriptions?: Record<string, string> | null;
  asset_urls?: string[] | null;
  garment_style_component_ids?: string[] | null;
  type?: string | null;
  placements?: string[] | null;
  default_variation_id?: string | null;
  is_default_on?: boolean | null;
  price?: number | null;
}

export async function createAddon(input: AddonCreateInput): Promise<Addon> {
  return adminFetch<Addon>("/admin/garment_addons", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateAddon(id: string, input: AddonUpdateInput): Promise<Addon> {
  return adminFetch<Addon>(`/admin/garment_addons/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function deleteAddon(id: string): Promise<void> {
  await adminFetch<void>(`/admin/garment_addons/${id}`, { method: "DELETE" });
}

// ─── Garment Add-on Variation types + helpers ────────────────────────────────

export interface AddonVariation {
  id: string;
  slug: string | null;
  addon_id: string | null;
  priority_order: number | null;
  labels: Record<string, string> | null;
  descriptions: Record<string, string> | null;
  asset_urls: string[] | null;
  style: string | null;
  shape: string | null;
  size: string | null;
  type: string | null;
  color: string | null;
  /** placement-specific pricing axis; null = applies at every placement */
  placement: string | null;
  price: number | null;
}

export interface AddonVariationCreateInput {
  slug: string;
  addon_id?: string | null;
  priority_order?: number | null;
  labels?: Record<string, string> | null;
  descriptions?: Record<string, string> | null;
  asset_urls?: string[] | null;
  style?: string | null;
  shape?: string | null;
  size?: string | null;
  type?: string | null;
  color?: string | null;
  placement?: string | null;
  price?: number | null;
}

export interface AddonVariationUpdateInput {
  slug?: string;
  addon_id?: string | null;
  priority_order?: number | null;
  labels?: Record<string, string> | null;
  descriptions?: Record<string, string> | null;
  asset_urls?: string[] | null;
  style?: string | null;
  shape?: string | null;
  size?: string | null;
  type?: string | null;
  color?: string | null;
  placement?: string | null;
  price?: number | null;
}

export async function createAddonVariation(input: AddonVariationCreateInput): Promise<AddonVariation> {
  return adminFetch<AddonVariation>("/admin/garment_addon_variations", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateAddonVariation(id: string, input: AddonVariationUpdateInput): Promise<AddonVariation> {
  return adminFetch<AddonVariation>(`/admin/garment_addon_variations/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function deleteAddonVariation(id: string): Promise<void> {
  await adminFetch<void>(`/admin/garment_addon_variations/${id}`, { method: "DELETE" });
}

// ─── Add-on variation price matrix ───────────────────────────────────────────

/** One matrix cell = one combination of axis values + its price. */
export interface AddonMatrixCellInput {
  axis_values: string[];
  price: number | null;
  is_default?: boolean;
  /**
   * Display-name override for the resulting variation. Null/empty =
   * auto-generate from the cell's style/type/shape values (size/color/
   * placement become tag badges on the card instead of name parts).
   */
  label?: string | null;
}

export interface AddonMatrixInput {
  /** Ordered axis columns used by the matrix, e.g. ["shape", "size"]. */
  axes: string[];
  /** Allowed values per axis, aligned with `axes`. */
  values: string[][];
  /** The cells to save. */
  cells: AddonMatrixCellInput[];
  /**
   * "add" (used by the matrix modal): create cells that don't exist yet,
   * price-update the ones that do, and never delete anything — rows missing
   * from `cells` are left untouched. "replace" reconciles the add-on's full
   * variation set to the payload, deleting unclaimed rows.
   */
  mode?: "add" | "replace";
}

export interface AddonMatrixResult {
  addon_id: string;
  created: number;
  updated: number;
  deleted: number;
  variations: AddonVariation[];
}

/**
 * Save an add-on price matrix (one row per combination). Existing rows are
 * matched by axis-value tuple, so combinations that already exist keep their
 * ids. The add-on's flat price is cleared server-side (it would otherwise
 * shadow the matrix prices).
 */
export async function saveAddonVariationMatrix(
  addonId: string,
  input: AddonMatrixInput,
): Promise<AddonMatrixResult> {
  return adminFetch<AddonMatrixResult>(`/admin/garment_addons/${addonId}/variations`, {
    method: "PUT",
    // Belt-and-suspenders: the endpoint's default is the non-destructive
    // "add", and the client injects it too — a caller (or stale bundle) that
    // forgets the flag must never fall through to a destructive reconcile.
    body: JSON.stringify({ mode: "add", ...input }),
  });
}

// ─── Catalogue helpers: fetch all rows by parent FK ──────────────────────────

/** Fetch ALL rows from a table where column = value. Returns rows array. */
export async function fetchByParent<T = Record<string, unknown>>(
  table: string,
  column: string,
  value: string,
  perPage = 100,
): Promise<T[]> {
  const allRows: T[] = [];
  let page = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const filter: FilterNode = {
      type: "group",
      logic: "and",
      children: [{ type: "filter", column, op: "eq", value }],
    };
    const data = await fetchTableData(table, page, perPage, { column: "priority_order", direction: "asc" }, filter);
    allRows.push(...(data.rows as T[]));
    if (page >= data.total_pages) break;
    page++;
  }
  return allRows;
}

/** Fetch ALL rows from a table (no parent filter). Returns rows array. */
export async function fetchAll<T = Record<string, unknown>>(table: string, perPage = 100): Promise<T[]> {
  const allRows: T[] = [];
  let page = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const data = await fetchTableData(table, page, perPage, { column: "created_at", direction: "desc" });
    allRows.push(...(data.rows as T[]));
    if (page >= data.total_pages) break;
    page++;
  }
  return allRows;
}

/** Get English label from a labels dict, falling back to slug or id. */
export function getLabel(labels: Record<string, string> | null | undefined, slug: string | null, id: string): string {
  if (labels?.en?.trim()) return labels.en;
  const firstVal = labels ? Object.values(labels).find((v) => v?.trim()) : null;
  if (firstVal) return firstVal;
  if (slug) return slug;
  return id.slice(0, 8) + "...";
}

/** Get English description from a descriptions dict. */
export function getDescription(descs: Record<string, string> | null | undefined): string | null {
  if (!descs) return null;
  if (descs.en?.trim()) return descs.en;
  const firstVal = Object.values(descs).find((v) => v?.trim());
  return firstVal ?? null;
}

/** Fallback placeholder image */
export const FALLBACK_IMAGE =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyMDAgMjAwIj48cmVjdCB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgZmlsbD0iI0YwRjBGMCIvPjxjaXJjbGUgY3g9IjEwMCIgY3k9IjgwIiByPSIzMCIgZmlsbD0iI0Q5RDlEOSIvPjxyZWN0IHg9IjcwIiB5PSIxMjAiIHdpZHRoPSI2MCIgaGVpZ2h0PSI0MCIgcng9IjQiIGZpbGw9IiNEOUQ5RDkiLz48L3N2Zz4=";

// ─── Priority reorder helper ────────────────────────────────────────────────

/**
 * Update the priority_order of a single row via the admin PUT endpoint.
 * entityType is the URL segment used in PUT /admin/{entityType}/{id}.
 */
export async function updatePriorityOrder(
  entityType: string,
  id: string,
  priorityOrder: number,
): Promise<void> {
  const token = getAdminToken();
  if (!token) throw new Error("No admin token");

  const res = await fetch(`${API_URL}/admin/${entityType}/${id}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ priority_order: priorityOrder }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as { error?: { message?: string } })?.error?.message ?? `Failed (${res.status})`,
    );
  }
}

/**
 * Update the priority_order of a single row via the GENERIC TABLE admin endpoint.
 * Used for tables that don't have dedicated CRUD routes (e.g. measurement_metrics).
 * Hits PUT /admin/tables/{tableName}/{id}.
 */
export async function updateTablePriorityOrder(
  tableName: string,
  id: string,
  priorityOrder: number,
): Promise<void> {
  const token = getAdminToken();
  if (!token) throw new Error("No admin token");

  const res = await fetch(`${API_URL}/admin/tables/${tableName}/${id}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ priority_order: priorityOrder }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as { error?: { message?: string } })?.error?.message ?? `Failed (${res.status})`,
    );
  }
}

// ─── Orders helpers ──────────────────────────────────────────────────────────
// Built on top of the generic table admin endpoints:
//   GET    /admin/tables/{table}
//   PUT    /admin/tables/{table}/{id}
//   DELETE /admin/tables/{table}/{id}
// Filter shape (JSON, URL-encoded as `filters` query param):
//   {"type":"group","logic":"and","children":[{"type":"filter","column":"x","op":"eq","value":"y"}]}

export type FulfillmentStatus =
  | "draft"
  | "pending"
  | "scheduled"
  | "in_progress"
  | "completed"
  | "delivered"
  | "cancelled";

export type PaymentStatus =
  | "pending"
  | "paid"
  | "partially_paid"
  | "partially_refunded"
  | "refunded"
  | "failed";

export type GarmentOrderStatus =
  | "pending"
  | "confirmed"
  | "in_production"
  | "ready"
  | "delivered";

export type JobStatus =
  | "draft"
  | "scheduled"
  | "in_progress"
  | "completed"
  | "cancelled";

/** Shape of the `slot` column on orders.
 *  In practice the DB stores one of:
 *    - null
 *    - a plain string ("morning")
 *    - a JSON object {"date": "YYYY-MM-DD", "slot": "HH:MM-HH:MM"}
 *  Be defensive and accept all three. */
export type OrderSlot =
  | string
  | { date?: string; slot?: string; window?: string; start?: string; end?: string }
  | null;

export interface OrderRow {
  id: string;
  user_id: string | null;
  address_id: string | null;
  total_price: number | null;
  advance_amount: number | null;
  payment_status: PaymentStatus | null;
  fulfillment_status: FulfillmentStatus | null;
  comments: string | null;
  order_number: string | null;
  slot: OrderSlot;
  created_at?: string;
  updated_at?: string;
  /**
   * Optional voice note (audio asset URL) recorded by the style captain at
   * the end of a measurement job (`orders.voice_note_asset_url`). Generic
   * table fetches populate it at runtime even on older typed callers.
   */
  voice_note_asset_url?: string | null;
  // Per-order acquisition (last-touch for this conversion).
  acquisition_source?: string | null;
  acquisition_campaign?: string | null;
  acquisition_medium?: string | null;
  acquisition_term?: string | null;
  acquisition_content?: string | null;
}

/** Safely render an order's `slot` value as a string, regardless of
 *  whether the DB stored it as a string, a JSON object, or null. */
export function formatOrderSlot(slot: OrderSlot): string {
  if (slot == null) return "—";
  if (typeof slot === "string") return slot;
  // Object form: {"date": "...", "slot": "..."} (or "window"/"start"/"end")
  const parts: string[] = [];
  if (slot.date) parts.push(slot.date);
  const windowVal = slot.slot ?? slot.window;
  if (windowVal) parts.push(windowVal);
  else if (slot.start && slot.end) parts.push(`${slot.start}-${slot.end}`);
  return parts.length > 0 ? parts.join(" ") : JSON.stringify(slot);
}

export interface GarmentOrderRow {
  id: string;
  order_id: string;
  garment_id: string;
  total_price: number | null;
  status: GarmentOrderStatus | null;
  user_note: string | null;
  /**
   * JSON list of asset URLs the customer shared as design inspiration
   * (e.g. ["/uploads/abc.jpg"]). Stored relative/absolute; resolve via
   * resolveAssetUrl() before rendering.
   */
  assets_shared: string[] | null;
  created_at?: string;
  updated_at?: string;
}

export interface GarmentOrderItemRow {
  id: string;
  garment_order_id: string;
  garment_style_component_id: string | null;
  type: "variation" | "add_on" | null;
  variation_id: string | null;
  variation_type_id: string | null;
  addon_id: string | null;
  addon_variation_id: string | null;
  /**
   * JSONB column: an array on rows written by the customer flow and the new
   * admin editor (["Sleeves"]), but a scalar string on rows written by older
   * admin flows. Consumers should normalize (see normalizePlacement in
   * GarmentSelectionSheet).
   */
  placement: string | string[] | null;
  price: number | null;
  custom_input: string | null;
  // JSONB column — the generic tables API returns it as an object, e.g. {en: "…"}
  label_snapshot: string | Record<string, string> | null;
  created_at?: string;
  updated_at?: string;
}

/** Admin-authored discount/fee. garment_order_id === null => whole-order scope. */
export interface OrderAdjustmentRow {
  id: string;
  order_id: string | null;
  garment_order_id: string | null;
  type: "discount" | "fee" | null;
  amount: number | null; // signed paise: negative = discount, positive = fee
  // JSONB column — the generic tables API returns it as an object, e.g. {en: "Rush fee"}
  label: string | Record<string, string> | null;
  target_type: string | null;
  source: string | null;
  source_ref: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface MeasurementJobRow {
  id: string;
  user_id: string | null;
  order_id: string | null;
  style_captain_id: string | null;
  status: JobStatus | null;
  scheduled_at: string | null;
  started_at?: string | null;
  performed_at: string | null;
  completed_at?: string | null;
  notes: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface TransactionRow {
  id: string;
  order_id: string | null;
  user_id: string | null;
  type: string | null;
  provider: string | null;
  provider_order_id: string | null;
  provider_payment_id: string | null;
  parent_transaction_id: string | null;
  amount: number | null;
  currency: string | null;
  status: string | null;
  method: string | null;
  method_detail: Record<string, unknown> | null;
  /** Audit metadata — manual/offline payments store their note at metadata.note. */
  metadata: Record<string, unknown> | null;
  failure_reason: string | null;
  collected_by: string | null;
  settlement_status: string | null;
  captured_at: string | null;
  refunded_at: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface UserRow {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  role: string | null;
  gender: string | null;
  country_code: string | null;
  created_at?: string;
  updated_at?: string;
  // First-touch acquisition (write-once at customer creation).
  acquisition_source?: string | null;
  acquisition_campaign?: string | null;
  acquisition_medium?: string | null;
  acquisition_term?: string | null;
  acquisition_content?: string | null;
}

export interface AddressRow {
  id: string;
  user_id: string;
  address_line_1: string | null;
  address_line_2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  coordinates: unknown;
  created_at?: string;
  updated_at?: string;
}

export interface GarmentRow {
  id: string;
  slug: string | null;
  labels: unknown;
  gender: string | null;
  base_price: number | null;
}

/** Fetch rows from a table with optional column filters + sort + pagination. */
export async function fetchTableRows<T = Record<string, unknown>>(
  table: string,
  opts: {
    filters?: Record<string, string | number | boolean | null>;
    page?: number;
    perPage?: number;
    sortColumn?: string;
    sortDirection?: "asc" | "desc";
  } = {},
): Promise<{ rows: T[]; total: number; columns: string[] }> {
  const params = new URLSearchParams();
  params.set("page", String(opts.page ?? 1));
  params.set("per_page", String(opts.perPage ?? 50));
  if (opts.sortColumn && opts.sortDirection) {
    // Backend FastAPI route declares `sort_column` and `sort_direction` query
    // params — do NOT rename to sort_by/sort_dir (they get silently ignored
    // and the query falls back to created_at DESC).
    params.set("sort_column", opts.sortColumn);
    params.set("sort_direction", opts.sortDirection);
  }
  if (opts.filters) {
    const children = Object.entries(opts.filters)
      .filter(([, v]) => v !== undefined)
      .map(([column, value]) => ({
        type: "filter" as const,
        column,
        op: value === null ? "is_null" : "eq",
        value,
      }));
    // URLSearchParams.toString() already URL-encodes the value,
    // so pass the raw JSON string — do NOT encodeURIComponent again.
    params.set(
      "filters",
      JSON.stringify({ type: "group", logic: "and", children }),
    );
  }
  // adminFetch prepends API_URL — pass a relative path.
  const data = await adminFetch<AdminTableData & { rows: T[] }>(
    `/admin/tables/${table}?${params.toString()}`,
  );
  return {
    rows: data.rows,
    total: data.total,
    columns: data.columns,
  };
}

/** Patch a single row in any admin table. */
export async function updateTableRow(
  table: string,
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  // adminFetch prepends API_URL — pass a relative path.
  // It also throws on !res.ok, so no need to re-check.
  await adminFetch(`/admin/tables/${table}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

/** Create a new row in any admin table. Returns the created row. */
export async function createTableRow<T = Record<string, unknown>>(
  table: string,
  data: Record<string, unknown>,
): Promise<T> {
  return adminFetch<T>(`/admin/tables/${table}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

/** Delete a single row from any admin table. */
export async function deleteTableRow(
  table: string,
  id: string,
): Promise<void> {
  await adminFetch(`/admin/tables/${table}/${id}`, {
    method: "DELETE",
  });
}

/** Convenience wrappers ─────────────────────────────────────────────────── */
export const updateOrder = (id: string, patch: Partial<OrderRow>) =>
  updateTableRow("orders", id, patch as Record<string, unknown>);
export const updateGarmentOrder = (id: string, patch: Partial<GarmentOrderRow>) =>
  updateTableRow("garment_orders", id, patch as Record<string, unknown>);
export const updateMeasurementJob = (id: string, patch: Partial<MeasurementJobRow>) =>
  updateTableRow("measurement_jobs", id, patch as Record<string, unknown>);

export const createOrder = (data: Partial<OrderRow>) =>
  createTableRow<OrderRow>("orders", data as Record<string, unknown>);
export const createGarmentOrder = (data: Partial<GarmentOrderRow> & { order_id: string }) =>
  createTableRow<GarmentOrderRow>("garment_orders", data as Record<string, unknown>);
export const createMeasurementJob = (data: Partial<MeasurementJobRow>) =>
  createTableRow<MeasurementJobRow>("measurement_jobs", data as Record<string, unknown>);
export const deleteMeasurementJob = (id: string) => deleteTableRow("measurement_jobs", id);
export const deleteGarmentOrder = (id: string) => deleteTableRow("garment_orders", id);
export const deleteGarmentOrderItem = (id: string) =>
  deleteTableRow("garment_orders_items", id);
export const deleteOrder = (id: string) => deleteTableRow("orders", id);
export const deleteUser = (id: string) => deleteTableRow("users", id);

/** Fetch every adjustment for an order (both garment-level and order-level). */
export async function fetchOrderAdjustments(
  orderId: string,
): Promise<OrderAdjustmentRow[]> {
  const { rows } = await fetchTableRows<OrderAdjustmentRow>("order_adjustments", {
    filters: { order_id: orderId },
    perPage: 100,
  });
  return rows;
}
export const createOrderAdjustment = (
  data: Partial<OrderAdjustmentRow> & { order_id: string },
) => createTableRow<OrderAdjustmentRow>("order_adjustments", data as Record<string, unknown>);
export const updateOrderAdjustment = (
  id: string,
  patch: Partial<OrderAdjustmentRow>,
) => updateTableRow("order_adjustments", id, patch as Record<string, unknown>);
export const deleteOrderAdjustment = (id: string) =>
  deleteTableRow("order_adjustments", id);

/** Fetch all style captains (users with role = "style_captain"). */
export async function fetchStyleCaptains(): Promise<UserRow[]> {
  const { rows } = await fetchTableRows<UserRow>("users", {
    filters: { role: "style_captain" },
    perPage: 100,
  });
  return rows;
}

/**
 * Search users whose name OR phone contains `q` (case-insensitive, via the
 * backend `contains` / ILIKE op under an OR group). Capped at 100 matches.
 * Used by the orders list to find orders by customer name/phone — orders only
 * carry user_id, so we resolve matching users first, then their orders.
 */
export async function searchUsersByNameOrPhone(q: string): Promise<UserRow[]> {
  const trimmed = q.trim();
  if (!trimmed) return [];
  const filter: FilterNode = {
    type: "group",
    logic: "or",
    children: [
      { type: "filter", column: "name", op: "contains", value: trimmed },
      { type: "filter", column: "phone", op: "contains", value: trimmed },
    ],
  };
  const data = await fetchTableData("users", 1, 100, undefined, filter);
  return data.rows as unknown as UserRow[];
}

// ─── Captain CRUD via dedicated /admin/captains endpoints ─────────────────────
// These endpoints handle password hashing on the backend — the generic table
// API would store plaintext, which we must avoid for the password column.

export interface CaptainPatch {
  name?: string;
  phone?: string;
  country_code?: string;
  email?: string;
  timezone?: string;
  /** Plaintext password — bcrypt-hashed server-side. */
  password?: string;
}

export interface CaptainCreate {
  name: string;
  phone: string;
  country_code?: string;
  /** Plaintext password — bcrypt-hashed server-side. */
  password: string;
  timezone?: string;
}

export interface CaptainOut {
  id: string;
  name: string | null;
  phone: string | null;
  country_code: string | null;
  role: string | null;
  timezone: string | null;
  last_login: string | null;
}

/** POST /admin/captains — create a new style captain with hashed password. */
export async function createCaptain(input: CaptainCreate): Promise<CaptainOut> {
  return adminFetch<CaptainOut>("/admin/captains", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** PATCH /admin/captains/{id} — update captain profile + password (hashed). */
export async function patchCaptain(
  captainId: string,
  patch: CaptainPatch,
): Promise<CaptainOut> {
  return adminFetch<CaptainOut>(`/admin/captains/${captainId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

/** Fetch a single user by ID. */
export async function fetchUserById(id: string): Promise<UserRow | null> {
  const { rows } = await fetchTableRows<UserRow>("users", {
    filters: { id },
    perPage: 1,
  });
  return rows[0] ?? null;
}

/** Fetch all garment orders that belong to a given order. */
export async function fetchGarmentOrdersForOrder(
  orderId: string,
): Promise<GarmentOrderRow[]> {
  const { rows } = await fetchTableRows<GarmentOrderRow>("garment_orders", {
    filters: { order_id: orderId },
    perPage: 100,
  });
  return rows;
}

/** Fetch all garment order items for a given garment order. */
export async function fetchGarmentOrderItems(
  garmentOrderId: string,
): Promise<GarmentOrderItemRow[]> {
  const { rows } = await fetchTableRows<GarmentOrderItemRow>(
    "garment_orders_items",
    {
      filters: { garment_order_id: garmentOrderId },
      perPage: 100,
    },
  );
  return rows;
}

/** Fetch measurement jobs attached to an order. */
export async function fetchJobsForOrder(
  orderId: string,
): Promise<MeasurementJobRow[]> {
  const { rows } = await fetchTableRows<MeasurementJobRow>("measurement_jobs", {
    filters: { order_id: orderId },
    perPage: 50,
  });
  return rows;
}

/** Fetch transactions for an order. */
export async function fetchTransactionsForOrder(
  orderId: string,
): Promise<TransactionRow[]> {
  const { rows } = await fetchTableRows<TransactionRow>("transactions", {
    filters: { order_id: orderId },
    perPage: 50,
  });
  return rows;
}

/** Fetch all garments (for the garment picker dropdown). */
export async function fetchGarments(): Promise<GarmentRow[]> {
  const { rows } = await fetchTableRows<GarmentRow>("garments", {
    perPage: 100,
    sortColumn: "slug",
    sortDirection: "asc",
  });
  return rows;
}

/** Resolve a garment label from its labels JSON or slug. */
export function garmentLabel(g: GarmentRow): string {
  if (g.labels && typeof g.labels === "object") {
    const labels = g.labels as Record<string, string>;
    return labels.en ?? labels.hi ?? Object.values(labels)[0] ?? g.slug ?? g.id;
  }
  return g.slug ?? g.id;
}

// ─── Catalog tree types + fetcher ────────────────────────────────────────────
// Mirrors the public GET /catalog/garments/{id} response (GarmentTreeOut).

export interface CatalogVariationType {
  id: string;
  labels: Record<string, string> | null;
  descriptions: Record<string, string> | null;
  asset_urls: string[] | null;
  priority_order: number | null;
  ideal_for: string[] | null;
  not_ideal_for: string[] | null;
  price: number | null;
}

export interface CatalogVariation {
  id: string;
  labels: Record<string, string> | null;
  descriptions: Record<string, string> | null;
  asset_urls: string[] | null;
  priority_order: number | null;
  ideal_for: string[] | null;
  not_ideal_for: string[] | null;
  price: number | null;
  default_type_id: string | null;
  variation_types: CatalogVariationType[];
}

export interface CatalogComponent {
  id: string;
  labels: Record<string, string> | null;
  descriptions: Record<string, string> | null;
  asset_urls: string[] | null;
  priority_order: number | null;
  importance: string | null;
  default_variation_id: string | null;
  variations: CatalogVariation[];
}

export interface CatalogAddonVariation {
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

export interface CatalogAddon {
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
  variations: CatalogAddonVariation[];
}

export interface GarmentTree {
  id: string;
  slug: string | null;
  labels: Record<string, string> | null;
  descriptions: Record<string, string> | null;
  asset_urls: string[] | null;
  gender: string | null;
  base_price: number | null;
  components: CatalogComponent[];
  addons: CatalogAddon[];
}

/** Fetch the full catalog tree for a garment (public endpoint, no auth needed). */
export async function fetchGarmentTree(garmentId: string): Promise<GarmentTree> {
  // This is a public endpoint — no Authorization header needed.
  const res = await fetch(`${API_URL}/catalog/garments/${garmentId}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch garment tree (${res.status})`);
  }
  return res.json() as Promise<GarmentTree>;
}

/** Get English label from a labels dict, with fallback. */
export function catalogLabel(labels: Record<string, string> | null | undefined, fallback: string): string {
  if (!labels) return fallback;
  return labels.en ?? Object.values(labels).find((v) => v?.trim()) ?? fallback;
}

// ─── Measurement Job Detail (body + garment measurements) ───────────────────

/** A row in the measurement_metrics catalog. */
export interface MeasurementMetricRow {
  id: string;
  code: string | null;
  slug: string | null;
  labels: Record<string, string> | null;
  descriptions: Record<string, string> | null;
  asset_urls: string[] | null;
  unit: string | null;
  priority_order: number | null;
}

/** A single reading taken during a measurement visit. */
export interface MeasurementReadingRow {
  id: string;
  measurement_job_id: string | null;
  measurement_metric_id: string | null;
  /** NULL = base (per-visit) reading; set = garment-instance reading. */
  garment_order_id?: string | null;
  value_numeric: number | null;
  value_text: string | null;
  unit: string | null;
  captured_at: string | null;
}

/** Cloth / addon material captured for a garment_order (the "garment measurement"). */
export interface GarmentOrderMaterialRow {
  id: string;
  garment_order_id: string;
  type: string | null; // "cloth" | "addon"
  name: string | null;
  color: string | null;
  length: number | null;
  breadth: number | null;
  unit: string | null;
  asset_urls: string[] | null;
  comment: string | null;
  created_at?: string;
  updated_at?: string;
}

/** A body metric paired with its reading (if any) for a given job. */
export interface BodyMeasurementWithMetric {
  metric: MeasurementMetricRow;
  reading: MeasurementReadingRow | null;
}

/** A garment order paired with its materials. */
export interface GarmentMeasurementGroup {
  garmentOrderId: string;
  garmentId: string | null;
  garmentSlug: string | null;
  garmentLabels: Record<string, string> | null;
  status: string | null;
  userNote: string | null;
  materials: GarmentOrderMaterialRow[];
  /** This garment instance's own readings (garment-scoped), rendered as a
   *  per-garment section on the PDF. */
  readings?: BodyMeasurementWithMetric[];
}

// ═══ Entity measurement links (entity_measurement_metrics) ═══════════════════
// Polymorphic (entity_type, entity_id) links deciding which metrics an
// entity demands, at what scope/order. entity_id has no DB FK — the backend
// write-time-guards every create (422 on unknown type / dead entity).

export type MeasurableEntityType =
  | "garment"
  | "variation"
  | "variation_type"
  | "addon"
  | "addon_variation";

/** Backing table per entity type — mirrors the backend registry. */
export const MEASURABLE_ENTITY_TABLES: Record<
  MeasurableEntityType,
  string
> = {
  garment: "garments",
  variation: "garment_style_component_variations",
  variation_type: "garment_style_component_variation_types",
  addon: "garment_addons",
  addon_variation: "garment_addon_variations",
};

export interface EntityMeasurementLink {
  id: string;
  entity_type: MeasurableEntityType | string | null;
  entity_id: string | null;
  measurement_metric_id: string | null;
  capture_scope: "per_job" | "per_garment" | string | null;
  is_required: boolean | null;
  priority_order: number | null;
  condition_note: string | null;
}

export interface EntityLinkInput {
  entity_type: MeasurableEntityType;
  entity_id: string;
  measurement_metric_id: string;
  capture_scope: "per_job" | "per_garment";
  is_required: boolean;
  priority_order?: number | null;
  condition_note?: string | null;
}

export async function listMeasurementLinks(params?: {
  entity_type?: string;
  entity_id?: string;
  measurement_metric_id?: string;
}): Promise<EntityMeasurementLink[]> {
  const qs = new URLSearchParams();
  if (params?.entity_type) qs.set("entity_type", params.entity_type);
  if (params?.entity_id) qs.set("entity_id", params.entity_id);
  if (params?.measurement_metric_id)
    qs.set("measurement_metric_id", params.measurement_metric_id);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  const data = await adminFetch<{ links: EntityMeasurementLink[] }>(
    `/admin/measurement-links${suffix}`,
  );
  return data.links;
}

export async function createMeasurementLink(
  input: EntityLinkInput,
): Promise<EntityMeasurementLink> {
  return adminFetch<EntityMeasurementLink>("/admin/measurement-links", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function deleteMeasurementLink(id: string): Promise<void> {
  await adminFetch(`/admin/measurement-links/${id}`, { method: "DELETE" });
}

/** Mutable config of a link — its entity/metric identity never changes. */
export interface EntityLinkPatch {
  capture_scope?: "per_job" | "per_garment";
  is_required?: boolean;
  priority_order?: number | null;
  condition_note?: string | null;
}

export async function updateMeasurementLink(
  id: string,
  patch: EntityLinkPatch,
): Promise<EntityMeasurementLink> {
  return adminFetch<EntityMeasurementLink>(`/admin/measurement-links/${id}`, {
    method: "PUT",
    body: JSON.stringify(patch),
  });
}

export interface OrphanLink {
  id: string;
  entity_type: string | null;
  entity_id: string | null;
  measurement_metric_id: string | null;
  capture_scope: string | null;
}

export async function listOrphanLinks(
  cleanup = false,
): Promise<{ orphans: OrphanLink[]; cleaned: number }> {
  return adminFetch<{ orphans: OrphanLink[]; cleaned: number }>(
    `/admin/measurement-links/orphans${cleanup ? "?cleanup=true" : ""}`,
  );
}

/** Fetch the full metric catalog, ordered by priority_order then code. */
export async function fetchMeasurementMetrics(): Promise<MeasurementMetricRow[]> {
  const { rows } = await fetchTableRows<MeasurementMetricRow>("measurement_metrics", {
    perPage: 100, // backend caps at le=100 — fetch in one page
    sortColumn: "priority_order",
    sortDirection: "asc",
  });
  return rows;
}

/** Fetch all readings for a measurement job. */
export async function fetchJobReadings(jobId: string): Promise<MeasurementReadingRow[]> {
  const { rows } = await fetchTableRows<MeasurementReadingRow>("measurements", {
    filters: { measurement_job_id: jobId },
    perPage: 100, // backend caps at le=100
  });
  return rows;
}

// ─── Admin job checklist (resolver output + saved readings) ─────────────────

/** A saved reading attached to a checklist metric (null = not captured). */
export interface ChecklistReading {
  id: string;
  value_numeric: number | null;
  value_text: string | null;
  unit: string | null;
  captured_at: string | null;
}

/** One metric on the checklist — expected fields + the saved reading. */
export interface ChecklistMetric {
  id: string; // measurement metric id
  code: string | null;
  slug: string | null;
  labels: Record<string, string> | null;
  descriptions: Record<string, string> | null;
  unit: string | null;
  is_required: boolean;
  priority_order: number | null;
  /** Which garments/selections pulled a per_job metric into the visit. */
  required_by?: { garment_order_id: string; entity_labels: string[] }[];
  /** Saved reading for this scope (base or this garment), if any. */
  reading?: ChecklistReading | null;
  /** True when the reading exists but the resolver no longer expects it. */
  extra?: boolean;
}

/** A per-garment section — metrics grouped by the owning entity. */
export interface ChecklistSection {
  entity: { type: string; id: string | null; label: string };
  metrics: ChecklistMetric[];
}

/** One garment instance on the checklist with its per-garment sections. */
export interface ChecklistGarment {
  garment_order_id: string;
  garment_id: string | null;
  label: string;
  status?: string | null;
  sections: ChecklistSection[];
}

/** Full checklist for a job: base (per-visit) metrics + per-garment sections,
 *  each metric carrying its saved reading. Mirrors the style-captain capture
 *  resolver, exposed for the admin order page. */
export interface AdminJobChecklist {
  job_id: string;
  order_id: string | null;
  job_status: string | null;
  base: ChecklistMetric[];
  garments: ChecklistGarment[];
}

/** Fetch the resolved checklist for a job with saved readings attached. */
export async function fetchAdminJobChecklist(
  jobId: string,
): Promise<AdminJobChecklist> {
  return adminFetch<AdminJobChecklist>(
    `/admin/measurement-jobs/${jobId}/checklist`,
  );
}

/** A garment order row (the per-order instance of a garment). */
export interface GarmentOrderInstanceRow {
  id: string;
  order_id: string | null;
  garment_id: string | null;
  status: string | null;
  user_note: string | null;
  created_at?: string;
  updated_at?: string;
}

/** Fetch all garment orders that belong to a given order (with garment catalog join done client-side). */
export async function fetchOrderGarmentOrders(orderId: string): Promise<GarmentOrderInstanceRow[]> {
  const { rows } = await fetchTableRows<GarmentOrderInstanceRow>("garment_orders", {
    filters: { order_id: orderId },
    perPage: 100,
  });
  return rows;
}

/** Fetch all garment_order_materials rows for the garment_orders under an order. */
export async function fetchOrderGarmentMaterials(orderId: string): Promise<GarmentOrderMaterialRow[]> {
  // First get the garment_order IDs for this order
  const garmentOrders = await fetchOrderGarmentOrders(orderId);
  if (garmentOrders.length === 0) return [];

  // Then get materials for each garment_order in parallel
  const materialBatches = await Promise.all(
    garmentOrders.map((go) =>
      fetchTableRows<GarmentOrderMaterialRow>("garment_order_materials", {
        filters: { garment_order_id: go.id },
        perPage: 100,
      }).then(({ rows }) => rows),
    ),
  );
  return materialBatches.flat();
}

/** Resolve a possibly-relative asset URL (e.g. "/cards/foo.jpg") against the API origin. */
export function resolveAssetUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("http://") || url.startsWith("https://")) {
    // Backend stores absolute URLs (e.g. http://localhost:8000/uploads/foo.png).
    // Rewrite to a same-origin relative path so the browser hits the Next.js
    // dev/server proxy (configured in next.config.mjs) instead of the backend
    // directly. This eliminates all CORS issues for <img>/fetch/canvas.
    try {
      const u = new URL(url);
      if (u.pathname.startsWith("/uploads/")) {
        return u.pathname; // same-origin relative
      }
    } catch {
      // Not a valid absolute URL — fall through.
    }
    return url;
  }
  // Public Next.js assets (/cards/*) are served from the frontend origin,
  // /uploads/* is proxied to the backend via next.config.mjs rewrites —
  // both stay relative (same-origin).
  if (url.startsWith("/cards/") || url.startsWith("/_next/") || url.startsWith("/uploads/")) {
    return url;
  }
  const origin = API_URL.replace(/\/api\/v\d+$/, "");
  return `${origin}${url}`;
}

/** Build the front-of-store absolute URL for a public asset. */
export function publicAssetAbsoluteUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  if (typeof window !== "undefined") {
    return `${window.location.origin}${url}`;
  }
  return url;
}

// ─── Design Library admin ───────────────────────────────────────────────────

export interface LibraryAdmin {
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
  status: string | null;
  priority_order: number | null;
}

export type LibraryUpdate = Partial<
  Omit<LibraryAdmin, "id" | "garment_id">
>;

/** GET /library/admin/list — all library designs (incl. draft/archived). */
export function adminListLibraries(status?: string): Promise<LibraryAdmin[]> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  return adminFetch<LibraryAdmin[]>(`/library/admin/list${qs}`);
}

/** PATCH /library/admin/{id} — update design fields. */
export function adminUpdateLibrary(id: string, patch: LibraryUpdate): Promise<LibraryAdmin> {
  return adminFetch<LibraryAdmin>(`/library/admin/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

/** POST /library/admin/{id}/image — upload hero/front/back/side image. */
export async function adminUploadLibraryImage(
  id: string,
  field: "hero" | "front" | "back" | "side",
  file: File,
): Promise<LibraryAdmin> {
  const token = getAdminToken();
  if (!token) throw new Error("No admin token");

  const form = new FormData();
  form.append("file", file);

  const res = await fetch(
    `${API_URL}/library/admin/${id}/image?field=${field}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    },
  );

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message =
      (body as { error?: { message?: string } })?.error?.message ??
      `Upload failed (${res.status})`;
    throw new Error(message);
  }

  return res.json() as Promise<LibraryAdmin>;
}

// ─── Library items admin ────────────────────────────────────────────────────

export interface LibraryItem {
  id: string;
  library_id: string | null;
  type: string; // "variation" | "add_on"
  garment_style_component_id: string | null;
  variation_id: string | null;
  variation_type_id: string | null;
  addon_id: string | null;
  addon_variation_id: string | null;
  placement: string[] | null;
  // resolved labels
  component_label: Record<string, string> | null;
  variation_label: Record<string, string> | null;
  variation_type_label: Record<string, string> | null;
  addon_label: Record<string, string> | null;
  addon_variation_label: Record<string, string> | null;
}

export interface LibraryItemCreate {
  garment_style_component_id?: string | null;
  variation_id?: string | null;
  variation_type_id?: string | null;
  addon_id?: string | null;
  addon_variation_id?: string | null;
  placement?: string[] | null;
}

// Picker tree shape
export interface PickerVariationType {
  id: string;
  slug: string | null;
  labels: Record<string, string> | null;
  price: number | null;
}
export interface PickerVariation {
  id: string;
  slug: string | null;
  labels: Record<string, string> | null;
  price: number | null;
  types: PickerVariationType[];
}
export interface PickerComponent {
  id: string;
  slug: string | null;
  labels: Record<string, string> | null;
  importance: string | null;
  variations: PickerVariation[];
}
export interface PickerAddonVariation {
  id: string;
  slug: string | null;
  labels: Record<string, string> | null;
  price: number | null;
}
export interface PickerAddon {
  id: string;
  slug: string | null;
  labels: Record<string, string> | null;
  placements: string[] | null;
  type: string | null;
  variations: PickerAddonVariation[];
}
export interface PickerTree {
  components: PickerComponent[];
  addons: PickerAddon[];
}

/** GET /library/admin/{id}/items */
export function adminListLibraryItems(id: string): Promise<LibraryItem[]> {
  return adminFetch<LibraryItem[]>(`/library/admin/${id}/items`);
}

/** POST /library/admin/{id}/items */
export function adminCreateLibraryItem(
  id: string,
  payload: LibraryItemCreate,
): Promise<LibraryItem> {
  return adminFetch<LibraryItem>(`/library/admin/${id}/items`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** PATCH /library/admin/items/{itemId} */
export function adminUpdateLibraryItem(
  itemId: string,
  patch: Partial<LibraryItemCreate>,
): Promise<LibraryItem> {
  return adminFetch<LibraryItem>(`/library/admin/items/${itemId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

/** DELETE /library/admin/items/{itemId} */
export function adminDeleteLibraryItem(itemId: string): Promise<void> {
  return adminFetch<void>(`/library/admin/items/${itemId}`, { method: "DELETE" });
}

/** GET /library/admin/{id}/picker */
export function adminGetPicker(id: string): Promise<PickerTree> {
  return adminFetch<PickerTree>(`/library/admin/${id}/picker`);
}

// ─── Admin Scheduling: open slots ────────────────────────────────────────────

export interface AdminSlotOption {
  start_at: string; // ISO datetime
  label: string;    // "HH:MM" in scheduling timezone
  captain_ids: string[]; // captains available at this slot
}

export interface AdminDaySlots {
  date: string; // ISO date
  slots: AdminSlotOption[];
}

export interface AdminSlotsResponse {
  days: AdminDaySlots[];
}

/** GET /admin/slots — available slots across all style captains (no order needed).
 *  `excludeJobId` makes the reschedule picker ignore that job's own current
 *  claim so its slot + buffer show as available. */
export function fetchOpenSlots(
  fromDate?: string,
  toDate?: string,
  excludeJobId?: string,
): Promise<AdminSlotsResponse> {
  const params = new URLSearchParams();
  if (fromDate) params.set("from_date", fromDate);
  if (toDate) params.set("to_date", toDate);
  if (excludeJobId) params.set("exclude_job_id", excludeJobId);
  const qs = params.toString();
  return adminFetch<AdminSlotsResponse>(`/admin/slots${qs ? `?${qs}` : ""}`);
}

// ─── Scheduling calendar (full grid: availability + bookings per slot) ──────

export interface CalendarCaptain {
  id: string;
  name: string;
}

export interface CalendarBookedCaptain extends CalendarCaptain {
  status: string; // booked | manual | blocked
  order_id: string | null; // for links to /admin/orders/{id}
  order_number: string | null;
}

export interface CalendarSlot {
  start_at: string;
  label: string;
  available: CalendarCaptain[];
  booked: CalendarBookedCaptain[];
}

export interface CalendarDay {
  date: string;
  slots: CalendarSlot[];
}

export interface CalendarResponse {
  days: CalendarDay[];
  slot_minutes: number;
}

/** GET /admin/calendar — every grid slot for the window with the captains
 *  available at it and the claims overlapping it (per-slot hover detail).
 *  `captainId` scopes grid / availability / claims to one captain. */
export function fetchCalendar(
  fromDate?: string,
  toDate?: string,
  captainId?: string,
): Promise<CalendarResponse> {
  const params = new URLSearchParams();
  if (fromDate) params.set("from_date", fromDate);
  if (toDate) params.set("to_date", toDate);
  if (captainId) params.set("captain_id", captainId);
  const qs = params.toString();
  return adminFetch<CalendarResponse>(`/admin/calendar${qs ? `?${qs}` : ""}`);
}

// ─── Admin visit creation / reassignment (auto-assign supported) ───────────

export interface AdminBookingResult {
  job_id: string;
  captain_id: string;
  slot_id: string;
  scheduled_at: string;
  status: string;
  assigned_via: "auto" | "admin";
}

/** POST /admin/bookings — schedule a visit for an order. captainId omitted
 *  → the backend auto-assigns the least-utilized free captain (same scorer
 *  as the customer booking flow) and holds the slot claim immediately. */
export function adminCreateBooking(
  orderId: string,
  startAt: string,
  captainId?: string,
): Promise<AdminBookingResult> {
  return adminFetch<AdminBookingResult>("/admin/bookings", {
    method: "POST",
    body: JSON.stringify({
      order_id: orderId,
      start_at: startAt,
      ...(captainId ? { captain_id: captainId } : {}),
    }),
  });
}

/** POST /admin/bookings/{jobId}/reassign — move a job to a captain.
 *  captainId omitted → auto-assign the least-utilized free captain at the
 *  target time; startAt omitted → keep the job's current scheduled_at. */
export function adminReassignBooking(
  jobId: string,
  opts: { captainId?: string; startAt?: string } = {},
): Promise<AdminBookingResult> {
  return adminFetch<AdminBookingResult>(
    `/admin/bookings/${jobId}/reassign`,
    {
      method: "POST",
      body: JSON.stringify({
        ...(opts.captainId ? { captain_id: opts.captainId } : {}),
        ...(opts.startAt ? { start_at: opts.startAt } : {}),
      }),
    },
  );
}

// ─── Design AI (image → Gemini analysis) ────────────────────────────────────

export interface AISelection {
  component_id: string;
  component_label: string | null;
  variation_id: string;
  variation_label: string | null;
  variation_type_id: string | null;
  variation_type_label: string | null;
}

export interface AIAddon {
  addon_id: string;
  addon_label: string | null;
  addon_variation_id: string | null;
  addon_variation_label: string | null;
  placement: string[] | null;
}

export interface AIUnknownItem {
  type: "variation" | "variation_type" | "addon" | "addon_variation";
  parent_id: string | null;
  parent_label: string | null;
  name: string;
  slug: string;
  description: string;
  suggested_price: number | null;
}

export interface AnalyzeDesignResult {
  image_url: string;
  selections: AISelection[];
  addons: AIAddon[];
  unknown_items: AIUnknownItem[];
}

export interface ApplyDesignResult {
  garment_order_id: string;
  total_price: number;
  items: GarmentOrderItemRow[];
  items_count: number;
}

/**
 * POST /admin/design-ai/analyze
 * Upload a reference image and get AI-generated design selections.
 */
export async function analyzeDesignImage(
  garmentId: string,
  image: File,
): Promise<AnalyzeDesignResult> {
  const token = getAdminToken();
  if (!token) throw new Error("No admin token");

  const formData = new FormData();
  formData.append("garment_id", garmentId);
  formData.append("image", image);

  const res = await fetch(`${API_URL}/admin/design-ai/analyze`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      // Don't set Content-Type — browser sets it with boundary for FormData
    },
    body: formData,
  });

  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    const msg =
      (detail as Record<string, unknown>)?.detail ??
      (detail as Record<string, unknown>)?.message ??
      `Analysis failed (${res.status})`;
    throw new Error(typeof msg === "string" ? msg : "Analysis failed");
  }

  return res.json() as Promise<AnalyzeDesignResult>;
}

/**
 * POST /admin/design-ai/upload
 * Upload a reference image and get its hosted URL (no AI call).
 *
 * Used to persist the design-inspiration image the moment it is selected,
 * so the draft order can save it immediately and the analyze step can reuse
 * the hosted URL instead of re-uploading the raw bytes.
 */
export async function uploadDesignImage(image: File): Promise<string> {
  const token = getAdminToken();
  if (!token) throw new Error("No admin token");

  const formData = new FormData();
  formData.append("image", image);

  const res = await fetch(`${API_URL}/admin/design-ai/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });

  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    const msg =
      (detail as Record<string, unknown>)?.detail ??
      (detail as Record<string, unknown>)?.message ??
      `Upload failed (${res.status})`;
    throw new Error(typeof msg === "string" ? msg : "Upload failed");
  }

  const data = (await res.json()) as { image_url: string };
  return data.image_url;
}

/**
 * POST /admin/design-ai/apply
 * Apply AI-generated selections to a garment order (replaces existing items).
 */
export async function applyDesignFromAI(
  garmentOrderId: string,
  selections: AISelection[],
  addons: AIAddon[],
  imageUrl?: string | null,
): Promise<ApplyDesignResult> {
  return adminFetch<ApplyDesignResult>("/admin/design-ai/apply", {
    method: "POST",
    body: JSON.stringify({
      garment_order_id: garmentOrderId,
      selections,
      addons,
      ...(imageUrl ? { image_url: imageUrl } : {}),
    }),
  });
}

// ─── Design AI Conversational Chat ───────────────────────────────────────────

export interface ChatDesignResult {
  image_url: string | null;
  message: string;
  selections: AISelection[];
  addons: AIAddon[];
  unknown_items: AIUnknownItem[];
}

/**
 * POST /admin/design-ai/chat
 * Send a message (text and/or image) to the conversational design AI.
 * Maintains thread state on the backend via thread_id.
 *
 * The image may be supplied as either a raw `File` (multipart upload) or an
 * `imageUrl` pointing at an image already saved via `uploadDesignImage`. The
 * URL path is preferred — it avoids re-uploading the bytes and reuses the
 * file persisted at selection time.
 */
export async function chatDesign(
  threadId: string,
  garmentId: string,
  options: { text?: string; image?: File; imageUrl?: string },
): Promise<ChatDesignResult> {
  const token = getAdminToken();
  if (!token) throw new Error("No admin token");

  const formData = new FormData();
  formData.append("thread_id", threadId);
  formData.append("garment_id", garmentId);
  if (options.text) formData.append("text", options.text);
  if (options.imageUrl) formData.append("image_url", options.imageUrl);
  if (options.image) formData.append("image", options.image);

  const res = await fetch(`${API_URL}/admin/design-ai/chat`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });

  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    const msg =
      (detail as Record<string, unknown>)?.detail ??
      (detail as Record<string, unknown>)?.message ??
      `Chat failed (${res.status})`;
    throw new Error(typeof msg === "string" ? msg : "Chat failed");
  }

  return res.json() as Promise<ChatDesignResult>;
}

/**
 * DELETE /admin/design-ai/chat/{thread_id}
 * Clear a conversation thread.
 */
export async function clearDesignThread(threadId: string): Promise<void> {
  const token = getAdminToken();
  if (!token) throw new Error("No admin token");

  await fetch(`${API_URL}/admin/design-ai/chat/${threadId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}


// ── Scheduling settings (Slot Scheduling admin sub-tab) ────────────────────

export interface SchedulingSettings {
  slot_minutes: number;
  /** Travel/setup buffer in GRID STEPS (buffer_slots on the wire; stored in
   *  scheduling_settings.buffer_minutes as a slot count). */
  buffer_slots: number;
  visit_minutes: number;
  lead_time_minutes: number;
  reschedule_cutoff_minutes: number;
  booking_horizon_days: number;
  scheduling_timezone: string;
}

export type SchedulingSettingsPatch = Partial<
  Omit<SchedulingSettings, "scheduling_timezone">
>;

export async function getSchedulingSettings(): Promise<SchedulingSettings> {
  return adminFetch<SchedulingSettings>("/admin/scheduling-settings");
}

export async function patchSchedulingSettings(
  patch: SchedulingSettingsPatch,
): Promise<SchedulingSettings> {
  return adminFetch<SchedulingSettings>("/admin/scheduling-settings", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

// ─── Receive payment / refund ───────────────────────────────────────────────

export interface ReceivePaymentResult {
  mode: string;
  transaction_id: string | null;
  cf_order_id: string | null;
  cf_link_id: string | null;
  link_url: string | null;
  payment_session_id: string | null;
  payment_link: string | null;
  sms_sent: boolean | null;
  environment: string | null;
  payment_status: string | null;
  balance_due: number | null;
}

export interface RefundResult {
  transaction_id: string | null;
  payment_status: string | null;
  balance_due: number | null;
}

export interface OrderBalance {
  total_price: number | null;
  captured: number | null;
  refunded: number | null;
  balance_due: number | null;
  payment_status: string | null;
}

/** Record a received payment (offline or via a Cashfree payment link). */
export async function receivePayment(
  orderId: string,
  payload: {
    amount_rupees: number;
    mode: "offline" | "cashfree";
    method?: string;
    method_detail?: Record<string, unknown>;
    note?: string;
    customer_phone?: string;
  },
): Promise<ReceivePaymentResult> {
  return adminFetch<ReceivePaymentResult>(`/admin/orders/${orderId}/payments`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** Record a refund (manual or via Cashfree). Supports partial refunds. */
export async function recordRefund(
  orderId: string,
  payload: {
    amount_rupees: number;
    reason?: string;
    parent_transaction_id?: string;
    provider?: "manual" | "cashfree";
  },
): Promise<RefundResult> {
  return adminFetch<RefundResult>(`/admin/orders/${orderId}/refunds`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** Live balance breakdown for an order. */
export async function getOrderBalance(orderId: string): Promise<OrderBalance> {
  return adminFetch<OrderBalance>(`/admin/orders/${orderId}/balance`);
}

// ─── Reports (admin Reports tab) ─────────────────────────────────────────────

export type ReportMetric = "revenue_booked" | "revenue_collected" | "orders_booked";
export type ReportBucket = "daily" | "weekly" | "monthly";

/** One customer's contribution to a bucket (tooltip row). */
export interface ReportItem {
  /** Customer name / phone. */
  label: string;
  /** Order or payment value in rupees. */
  value: number;
}

export interface ReportPoint {
  /** Bucket start, YYYY-MM-DD (Mon for weekly, 1st for monthly). */
  bucket_start: string;
  /** Rupee integers for revenue metrics, count for orders_booked. */
  value: number;
  /** Per-customer breakdown for the tooltip, largest first. */
  items?: ReportItem[];
}

export interface ReportSeries {
  metric: ReportMetric;
  bucket: ReportBucket;
  from_date: string;
  to_date: string;
  points: ReportPoint[];
}

/**
 * GET /admin/reports/series — one gap-filled, time-bucketed series.
 * Omit range to use the backend's default window for the bucket.
 */
export async function fetchReportSeries(
  metric: ReportMetric,
  bucket: ReportBucket,
  range?: { from?: string; to?: string },
): Promise<ReportSeries> {
  const params = new URLSearchParams({ metric, bucket });
  if (range?.from) params.set("from", range.from);
  if (range?.to) params.set("to", range.to);
  return adminFetch<ReportSeries>(`/admin/reports/series?${params.toString()}`);
}

// ─── Short links (Configure → URLs admin sub-tab) ───────────────────────────

export interface ShortLink {
  id: string;
  slug: string | null;
  destination: string | null;
  label: string | null;
  is_active: boolean | null;
  expires_at: string | null;
  click_limit: number | null;
  click_count: number | null;
  last_clicked_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface ShortLinkList {
  links: ShortLink[];
  total: number;
}

export interface ShortLinkCreateInput {
  destination: string;
  /** Feeds the default `<sanitized-name>-<random5>` slug when `slug` is omitted. */
  name?: string;
  slug?: string;
  label?: string;
  is_active?: boolean;
  expires_at?: string | null;
  click_limit?: number | null;
}

/** Fields explicitly present are written — null clears the optional ones. */
export interface ShortLinkUpdateInput {
  destination?: string;
  slug?: string;
  label?: string | null;
  is_active?: boolean;
  expires_at?: string | null;
  click_limit?: number | null;
  /** Accepted so the counter can be reset (e.g. after bumping the limit). */
  click_count?: number;
}

export async function listShortLinks(): Promise<ShortLinkList> {
  return adminFetch<ShortLinkList>("/admin/short-links");
}

export async function createShortLink(input: ShortLinkCreateInput): Promise<ShortLink> {
  return adminFetch<ShortLink>("/admin/short-links", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateShortLink(
  id: string,
  input: ShortLinkUpdateInput,
): Promise<ShortLink> {
  return adminFetch<ShortLink>(`/admin/short-links/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function deleteShortLink(id: string): Promise<void> {
  await adminFetch<void>(`/admin/short-links/${id}`, { method: "DELETE" });
}

// ─── Admin AI content (descriptions + images) ────────────────────────────────

export type AiEntityType =
  | "garment"
  | "component"
  | "variation"
  | "variation_type"
  | "addon"
  | "addon_variation";

export interface AiContentInput {
  entity_type: AiEntityType;
  /** Saved row id — when present the backend reads context from the DB. */
  entity_id?: string | null;
  /** Unsaved child rows: the parent's id (component/variation/addon/garment). */
  parent_id?: string | null;
  /** All typed labels, lang → value (unsaved edits override the DB). */
  names?: Record<string, string> | null;
  /** All typed descriptions, lang → value. */
  descriptions?: Record<string, string> | null;
}

export interface AiDescribeInput extends AiContentInput {
  language: string;
  /** Current name in the target language (may be empty). */
  name?: string | null;
  /** Existing description in the target language, if any. */
  existing_description?: string | null;
}

export interface AiDescribeResult {
  language: string;
  /** null when the AI couldn't produce one and the form should keep its own. */
  name: string | null;
  description: string;
}

export interface AiImageResult {
  url: string;
  prompt: string;
}

export async function aiDescribe(input: AiDescribeInput): Promise<AiDescribeResult> {
  return adminFetch<AiDescribeResult>("/admin/ai-content/describe", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function aiGenerateImage(input: AiContentInput): Promise<AiImageResult> {
  return adminFetch<AiImageResult>("/admin/ai-content/image", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/**
 * POST /admin/ai-content/inspiration
 * Render one AI design-inspiration image for a garment order's saved
 * selections (titles + descriptions, catalog house style), with an optional
 * designer comment as extra direction (the Regenerate button sends it).
 */
export async function aiGenerateInspiration(input: {
  garment_order_id: string;
  comment?: string | null;
}): Promise<AiImageResult> {
  return adminFetch<AiImageResult>("/admin/ai-content/inspiration", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// ─── SOP Video Generator ──────────────────────────────────────────────────────

export type SopVideoLang = "english" | "hindi" | "kannada";
export const SOP_VIDEO_LANGUAGES: { key: SopVideoLang; label: string }[] = [
  { key: "english", label: "English" },
  { key: "hindi", label: "Hindi" },
  { key: "kannada", label: "Kannada" },
];

export interface SopVideoLangState {
  status: "pending" | "narrating" | "subtitles" | "building" | "done" | "error";
  slides_done: number;
  notes_detected: boolean;
  notes_generated: boolean;
  download_url: string | null;
  filename: string | null;
  duration_s: number | null;
  error: string | null;
}

export interface SopVideoJob {
  job_id: string;
  status: "pending" | "running" | "completed" | "failed";
  step: string;
  total_slides: number;
  subtitles: boolean;
  languages: Partial<Record<SopVideoLang, SopVideoLangState>>;
  error: string | null;
}

/**
 * POST /admin/sop-video/jobs — upload a .pptx/.pdf and start video generation.
 * Multipart, so it can't go through adminFetch (which forces JSON headers).
 */
export async function createSopVideoJob(input: {
  file: File;
  mode: "generate" | "detect";
  languages: SopVideoLang[];
  subtitles: boolean;
}): Promise<{ job_id: string }> {
  const token = getAdminToken();
  if (!token) throw new Error("No admin token");

  const formData = new FormData();
  formData.append("file", input.file);
  formData.append("mode", input.mode);
  formData.append("languages", input.languages.join(","));
  formData.append("subtitles", input.subtitles ? "true" : "false");

  const res = await fetch(`${API_URL}/admin/sop-video/jobs`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let message = `Upload failed (${res.status})`;
    if (text) {
      try {
        const body = JSON.parse(text) as { error?: { message?: string } };
        message = body?.error?.message ?? message;
      } catch {
        // Non-JSON error body
      }
    }
    throw new Error(message);
  }
  return (await res.json()) as { job_id: string };
}

export async function getSopVideoJob(jobId: string): Promise<SopVideoJob> {
  return adminFetch<SopVideoJob>(`/admin/sop-video/jobs/${jobId}`);
}

export async function deleteSopVideoJob(jobId: string): Promise<void> {
  return adminFetch<void>(`/admin/sop-video/jobs/${jobId}`, { method: "DELETE" });
}

/**
 * Full URL for a finished video. The <video> tag and download links can't send
 * an Authorization header, so the admin token rides along as ?token=.
 */
export function sopVideoFileUrl(jobId: string, lang: SopVideoLang): string {
  const token = getAdminToken() ?? "";
  return `${API_URL}/admin/sop-video/jobs/${jobId}/file/${lang}?token=${encodeURIComponent(token)}`;
}


/** A hold promoted by POST /admin/orders/{id}/confirm-slot. */
export interface PromotedSlot {
  job_id: string;
  captain_id: string;
  slot_id: string;
  scheduled_at: string;
}

/**
 * POST /admin/orders/{orderId}/confirm-slot — promote the order's draft slot
 * hold into a real booked visit (auto-assigns a captain). 409 slot_taken when
 * no captain is free at the held time; the hold is left in place either way.
 */
export async function confirmOrderSlot(
  orderId: string,
): Promise<{ order_id: string; promoted: PromotedSlot[] }> {
  return adminFetch(`/admin/orders/${orderId}/confirm-slot`, { method: "POST" });
}
