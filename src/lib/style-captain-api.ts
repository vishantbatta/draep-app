/**
 * Style-captain API client — thin wrapper around fetch.
 * Reads the JWT from localStorage (key: draep_sc_token) and injects
 * the Authorization header.
 */

// Relative so all calls are same-origin (proxied to backend via next.config.mjs
// rewrites — eliminates all CORS issues).
const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "/api/v1";
const TOKEN_KEY = "draep_sc_token";
const USER_KEY = "draep_sc_user";

export function getSCToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setSCToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearSCToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function getSCUser(): SCUser | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SCUser;
  } catch {
    return null;
  }
}

function setSCUser(user: SCUser): void {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

// ─── Types ─────────────────────────────────────────────────────────────────

export interface SCUser {
  id: string;
  name: string | null;
  phone: string | null;
  country_code: string | null;
  email: string | null;
  role: string | null;
}

export interface SCMeasurement {
  id: string;
  measurement_metric_id: string | null;
  value_numeric: number | null;
  value_text: string | null;
  unit: string | null;
  captured_at?: string | null;
}

export interface SCGarmentBrief {
  id: string;
  slug: string | null;
  labels: Record<string, string> | null;
}

export interface SCGarmentOrderMaterial {
  id: string;
  garment_order_id: string;
  type: "cloth" | "addon";
  name: string | null;
  color: string | null;
  length: number | null;
  breadth: number | null;
  unit: string | null;
  asset_urls: string[] | null;
  comment: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface SCGarmentOrder {
  id: string;
  garment_id: string | null;
  garment_slug: string | null;
  garment_labels: Record<string, string> | null;
  status: string | null;
  user_note: string | null;
  materials: SCGarmentOrderMaterial[];
}

export interface SCJob {
  id: string;
  status: string | null;
  scheduled_at: string | null;
  performed_at: string | null;
  notes: string | null;
  created_at: string | null;
  // Customer
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_country_code: string | null;
  // Address
  address_id: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  coordinates: Record<string, unknown> | null;
  // Order
  order_id: string | null;
  order_number: string | null;
  order_comments: string | null;
  slot: Record<string, unknown> | null;
  garments: SCGarmentBrief[];
  garment_orders: SCGarmentOrder[];
  measurements: SCMeasurement[];
}

export interface SCMetric {
  id: string;
  code: string | null;
  slug: string | null;
  labels: Record<string, string> | null;
  descriptions: Record<string, string> | null;
  asset_urls: string[] | null;
  unit: string | null;
}

// ─── Fetch wrapper ──────────────────────────────────────────────────────────

async function scFetch<T>(
  path: string,
  options?: RequestInit & { auth?: boolean },
): Promise<T> {
  const { auth = true, headers = {}, ...rest } = options ?? {};
  const finalHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...(headers as Record<string, string>),
  };

  if (auth) {
    const token = getSCToken();
    if (!token) throw new Error("No style-captain token");
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

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ─── Endpoints ──────────────────────────────────────────────────────────────

export async function scLogin(phone: string, password: string): Promise<SCUser> {
  const data = await scFetch<{ token: string; user: SCUser }>(
    "/style-captain/login",
    {
      method: "POST",
      auth: false,
      body: JSON.stringify({ phone, password }),
    },
  );
  setSCToken(data.token);
  setSCUser(data.user);
  return data.user;
}

export async function scFetchMe(): Promise<SCUser> {
  const user = await scFetch<SCUser>("/style-captain/me");
  setSCUser(user);
  return user;
}

export async function scFetchJobs(
  status?: string,
): Promise<SCJob[]> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  const data = await scFetch<{ jobs: SCJob[] }>(`/style-captain/jobs${qs}`);
  return data.jobs;
}

export async function scFetchJob(jobId: string): Promise<SCJob> {
  return scFetch<SCJob>(`/style-captain/jobs/${jobId}`);
}

export async function scFetchMetrics(): Promise<SCMetric[]> {
  const data = await scFetch<{ metrics: SCMetric[] }>(`/style-captain/metrics`);
  return data.metrics;
}

export async function scStartJob(jobId: string): Promise<void> {
  await scFetch(`/style-captain/jobs/${jobId}/start`, { method: "POST" });
}

export interface MeasurementPayload {
  measurement_metric_id: string;
  value_numeric?: number | null;
  value_text?: string | null;
  unit?: string | null;
}

export async function scSaveMeasurements(
  jobId: string,
  measurements: MeasurementPayload[],
): Promise<SCMeasurement[]> {
  return scFetch<SCMeasurement[]>(`/style-captain/jobs/${jobId}/measurements`, {
    method: "POST",
    body: JSON.stringify({ measurements }),
  });
}

export async function scCompleteJob(
  jobId: string,
  notes?: string,
): Promise<void> {
  await scFetch(`/style-captain/jobs/${jobId}/complete`, {
    method: "POST",
    body: JSON.stringify({
      notes: notes ?? "",
    }),
  });
}

// ─── garment_order_materials CRUD ──────────────────────────────────────────
// Per DB Schema Bible: this is the captain's flat capture table for cloth
// pieces (blouse, lining, patti) and add-ons (latkan) at the visit.

export interface SCMaterialInput {
  garment_order_id?: string; // required on POST
  type: "cloth" | "addon";
  name?: string | null;
  color?: string | null;
  length?: number | null;
  breadth?: number | null;
  unit?: "m" | "in" | "cm" | null;
  asset_urls?: string[] | null;
  comment?: string | null;
}

export async function scListMaterials(
  jobId: string,
  garmentOrderId: string,
): Promise<SCGarmentOrderMaterial[]> {
  return scFetch<SCGarmentOrderMaterial[]>(
    `/style-captain/jobs/${jobId}/garment-orders/${garmentOrderId}/materials`,
  );
}

export async function scCreateMaterial(
  input: SCMaterialInput,
): Promise<SCGarmentOrderMaterial> {
  return scFetch<SCGarmentOrderMaterial>(`/style-captain/materials`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function scUpdateMaterial(
  materialId: string,
  input: SCMaterialInput,
): Promise<SCGarmentOrderMaterial> {
  return scFetch<SCGarmentOrderMaterial>(
    `/style-captain/materials/${materialId}`,
    {
      method: "PUT",
      body: JSON.stringify(input),
    },
  );
}

export async function scDeleteMaterial(materialId: string): Promise<void> {
  await scFetch(`/style-captain/materials/${materialId}`, {
    method: "DELETE",
  });
}

export interface SCPhotoUploadResult {
  url: string;
  filename: string;
  size: number;
}

export async function scUploadPhotos(
  jobId: string,
  files: File[],
): Promise<SCPhotoUploadResult[]> {
  const token = getSCToken();
  if (!token) throw new Error("No style-captain token");

  const formData = new FormData();
  for (const f of files) {
    formData.append("files", f);
  }

  const res = await fetch(
    `${API_URL}/style-captain/jobs/${jobId}/photos`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    },
  );

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message =
      (body as { error?: { message?: string } })?.error?.message ??
      `Upload failed (${res.status})`;
    throw new Error(message);
  }

  return res.json() as Promise<SCPhotoUploadResult[]>;
}

export interface SCWalkInResult {
  job_id: string;
  user_id: string;
  is_new_user: boolean;
}

export async function scCreateWalkInJob(
  name: string,
  phone: string,
  notes?: string,
): Promise<SCWalkInResult> {
  return scFetch<SCWalkInResult>("/style-captain/walk-in", {
    method: "POST",
    body: JSON.stringify({ name, phone, notes: notes ?? null }),
  });
}
