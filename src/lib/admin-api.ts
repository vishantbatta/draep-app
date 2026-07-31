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
}

export interface StyleComponentUpdateInput {
  slug?: string;
  garment_id?: string | null;
  priority_order?: number | null;
  labels?: Record<string, string> | null;
  descriptions?: Record<string, string> | null;
  asset_urls?: string[] | null;
  importance?: string | null;
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
  | "cancelled";

export type PaymentStatus =
  | "pending"
  | "paid"
  | "failed"
  | "refunded"
  | "partial_refunded";

export type GarmentOrderStatus =
  | "pending"
  | "confirmed"
  | "in_production"
  | "ready"
  | "delivered";

export type JobStatus =
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
  style_captain_id: string | null;
  order_number: string | null;
  slot: OrderSlot;
  created_at?: string;
  updated_at?: string;
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
  assets_shared: boolean | null;
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
  placement: string | null;
  price: number | null;
  custom_input: string | null;
  label_snapshot: string | null;
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
  amount: number | null;
  status: string | null;
  method: string | null;
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

/** Fetch all style captains (users with role = "style_captain"). */
export async function fetchStyleCaptains(): Promise<UserRow[]> {
  const { rows } = await fetchTableRows<UserRow>("users", {
    filters: { role: "style_captain" },
    perPage: 100,
  });
  return rows;
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

/** GET /admin/slots — available slots across all style captains (no order needed). */
export function fetchOpenSlots(
  fromDate?: string,
  toDate?: string,
): Promise<AdminSlotsResponse> {
  const params = new URLSearchParams();
  if (fromDate) params.set("from_date", fromDate);
  if (toDate) params.set("to_date", toDate);
  const qs = params.toString();
  return adminFetch<AdminSlotsResponse>(`/admin/slots${qs ? `?${qs}` : ""}`);
}

