/**
 * Admin API client — thin wrapper around fetch.
 * Reads the JWT from localStorage and injects the Authorization header.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";
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
    const body = await res.json().catch(() => ({}));
    const message =
      (body as { error?: { message?: string } })?.error?.message ??
      `Request failed (${res.status})`;
    throw new Error(message);
  }

  return res.json() as Promise<T>;
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
