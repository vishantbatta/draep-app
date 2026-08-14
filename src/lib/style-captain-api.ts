/**
 * Style-captain API client — thin wrapper around fetch.
 *
 * Auth model: a short-lived access JWT (key: draep_sc_token) + a long-lived
 * refresh token (key: draep_sc_refresh). On a 401 the wrapper transparently
 * calls /refresh (single-flight across concurrent requests), swaps the tokens,
 * and retries the original call exactly once. A refresh failure is terminal —
 * the session is dead and we dispatch an "sc:unauthorized" CustomEvent so the
 * layout can redirect to login.
 */

// Relative so all calls are same-origin (proxied to backend via next.config.mjs
// rewrites — eliminates all CORS issues).
const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "/api/v1";
const TOKEN_KEY = "draep_sc_token";
const REFRESH_TOKEN_KEY = "draep_sc_refresh";
const USER_KEY = "draep_sc_user";

export function getSCToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setSCToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

function getSCRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

function setSCRefreshToken(token: string): void {
  localStorage.setItem(REFRESH_TOKEN_KEY, token);
}

/** Clear all stored style-captain credentials (access + refresh + user). */
export function clearSCTokens(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

/** Back-compat shim — old call sites still call clearSCToken(). */
export function clearSCToken(): void {
  clearSCTokens();
}

/**
 * Thrown when the session is terminally invalid (no refresh token, refresh
 * failed, or the retried request still 401'd). Carries kind="sc_unauthorized"
 * so the layout can detect "session dead" vs a normal API error.
 */
export class SCAuthError extends Error {
  readonly kind = "sc_unauthorized" as const;
  constructor(message = "Style-captain session expired") {
    super(message);
    this.name = "SCAuthError";
  }
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
  /** NULL = base (per-visit) reading; set = reading for that garment instance. */
  garment_order_id?: string | null;
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
  started_at: string | null;
  performed_at: string | null;
  completed_at: string | null;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
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
  /** Entity-derived capture checklist (base + per-garment sections). */
  checklist: SCChecklist | null;
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

/** A metric as the checklist resolver returns it — catalog fields + link config. */
export interface SCChecklistMetric extends SCMetric {
  is_required: boolean;
  priority_order: number | null;
}

export interface SCChecklistSection {
  entity: {
    type: string;
    id: string;
    label: string;
  };
  metrics: SCChecklistMetric[];
}

export interface SCChecklistGarment {
  garment_order_id: string;
  garment_id: string | null;
  label: string;
  sections: SCChecklistSection[];
}

export interface SCChecklist {
  base: SCChecklistMetric[];
  garments: SCChecklistGarment[];
}

// ─── Fetch wrapper ──────────────────────────────────────────────────────────

/** Pull `error.message` out of the {error:{...}} envelope, with a fallback. */
async function readErrorMessage(res: Response, fallbackPrefix: string) {
  const body = await res.json().catch(() => ({}));
  return (
    (body as { error?: { message?: string } })?.error?.message ??
    `${fallbackPrefix} (${res.status})`
  );
}

/** Tell the layout the session is dead so it can redirect to login. */
function signalSessionDead(): void {
  clearSCTokens();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("sc:unauthorized"));
  }
}

/**
 * Call /style-captain/refresh using fetch directly (NOT scFetch — that would
 * recurse on a 401). Single-flighted via `refreshInFlight` so concurrent 401s
 * coalesce into one network request and all awaiters get the same result.
 * Resolves true on success (tokens swapped), false on terminal failure.
 */
let refreshInFlight: Promise<boolean> | null = null;

async function doRefresh(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const refreshToken = getSCRefreshToken();
    if (!refreshToken) return false;
    try {
      const res = await fetch(`${API_URL}/style-captain/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!res.ok) return false;
      const data = (await res.json()) as {
        access_token: string;
        refresh_token: string;
      };
      setSCToken(data.access_token);
      setSCRefreshToken(data.refresh_token);
      return true;
    } catch {
      return false;
    }
  })();
  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

async function scFetch<T>(
  path: string,
  options?: RequestInit & { auth?: boolean },
): Promise<T> {
  const { auth = true, headers = {}, ...rest } = options ?? {};

  const buildHeaders = (): Record<string, string> => {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      ...(headers as Record<string, string>),
    };
    if (auth) {
      const token = getSCToken();
      if (token) h["Authorization"] = `Bearer ${token}`;
    }
    return h;
  };

  // First attempt.
  if (auth && !getSCToken()) {
    // No access token at all — try a refresh before we even fire the request.
    const ok = await doRefresh();
    if (!ok) {
      signalSessionDead();
      throw new SCAuthError();
    }
  }

  let res = await fetch(`${API_URL}${path}`, {
    ...rest,
    headers: buildHeaders(),
  });

  // 401 on an authed request → refresh (single-flight) and retry exactly once.
  if (res.status === 401 && auth) {
    const ok = await doRefresh();
    if (!ok) {
      signalSessionDead();
      throw new SCAuthError();
    }
    res = await fetch(`${API_URL}${path}`, {
      ...rest,
      headers: buildHeaders(),
    });
    if (res.status === 401) {
      signalSessionDead();
      throw new SCAuthError();
    }
  }

  if (!res.ok) {
    const message = await readErrorMessage(res, "Request failed");
    throw new Error(message);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/**
 * Run a raw fetch (used for multipart uploads that bypass scFetch) with the
 * same 401 → refresh-single-flight → retry-once semantics. `run(token)` issues
 * the actual request with the given bearer token; we handle auth-retry.
 */
async function withRefresh<T>(
  run: (token: string) => Promise<Response>,
): Promise<T> {
  let token = getSCToken();
  if (!token) {
    const ok = await doRefresh();
    if (!ok) {
      signalSessionDead();
      throw new SCAuthError();
    }
    token = getSCToken();
  }

  let res = await run(token!);

  if (res.status === 401) {
    const ok = await doRefresh();
    if (!ok) {
      signalSessionDead();
      throw new SCAuthError();
    }
    token = getSCToken();
    res = await run(token!);
    if (res.status === 401) {
      signalSessionDead();
      throw new SCAuthError();
    }
  }

  if (!res.ok) {
    const message = await readErrorMessage(res, "Upload failed");
    throw new Error(message);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ─── Endpoints ──────────────────────────────────────────────────────────────

export async function scLogin(phone: string, password: string): Promise<SCUser> {
  const data = await scFetch<{
    access_token: string;
    refresh_token: string;
    user: SCUser;
  }>("/style-captain/login", {
    method: "POST",
    auth: false,
    body: JSON.stringify({ phone, password }),
  });
  setSCToken(data.access_token);
  setSCRefreshToken(data.refresh_token);
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

/** Lightweight checklist — live re-derivation on mid-visit changes.
 *  With garmentOrderId, only that garment instance's entry is returned. */
export async function scFetchChecklist(
  jobId: string,
  garmentOrderId?: string,
): Promise<SCChecklist> {
  const qs = garmentOrderId
    ? `?garment_order_id=${encodeURIComponent(garmentOrderId)}`
    : "";
  return scFetch<SCChecklist>(`/style-captain/jobs/${jobId}/checklist${qs}`);
}

/** Catalogue garments — for the walk-in garment-type picker. */
export async function scFetchCatalogueGarments(): Promise<SCGarmentBrief[]> {
  return scFetch<SCGarmentBrief[]>(`/style-captain/catalogue/garments`);
}

export async function scStartJob(jobId: string): Promise<void> {
  await scFetch(`/style-captain/jobs/${jobId}/start`, { method: "POST" });
}

export interface MeasurementPayload {
  measurement_metric_id: string;
  /** NULL/omitted = base (per-visit) reading; set = garment-instance reading. */
  garment_order_id?: string | null;
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
  voiceNoteAssetUrl?: string,
  acknowledgeWarnings?: boolean,
): Promise<void> {
  await scFetch(`/style-captain/jobs/${jobId}/complete`, {
    method: "POST",
    body: JSON.stringify({
      notes: notes ?? "",
      voice_note_asset_url: voiceNoteAssetUrl ?? null,
      acknowledge_warnings: acknowledgeWarnings ?? false,
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
  const formData = new FormData();
  for (const f of files) {
    formData.append("files", f);
  }
  return withRefresh<SCPhotoUploadResult[]>((token) =>
    fetch(`${API_URL}/style-captain/jobs/${jobId}/photos`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    }),
  );
}

export async function scUploadVoiceNote(
  jobId: string,
  file: Blob,
): Promise<SCPhotoUploadResult> {
  const formData = new FormData();
  formData.append("file", file);
  return withRefresh<SCPhotoUploadResult>((token) =>
    fetch(`${API_URL}/style-captain/jobs/${jobId}/voice-note`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    }),
  );
}

/**
 * Revoke the current refresh token server-side (logout this device).
 * Best-effort: clears local tokens first for instant UX, then fires the
 * request. Safe to call with no/expired access token — failures are swallowed.
 */
export async function scLogout(): Promise<void> {
  const refreshToken = getSCRefreshToken();
  const token = getSCToken();
  clearSCTokens();
  if (!refreshToken || !token) return;
  try {
    await fetch(`${API_URL}/style-captain/logout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
  } catch {
    // best-effort — local creds already cleared
  }
}

export interface SCWalkInResult {
  job_id: string;
  user_id: string;
  is_new_user: boolean;
}

export async function scCreateWalkInJob(
  name: string,
  phone: string,
  garmentId: string,
  notes?: string,
): Promise<SCWalkInResult> {
  return scFetch<SCWalkInResult>("/style-captain/walk-in", {
    method: "POST",
    body: JSON.stringify({
      name,
      phone,
      garment_id: garmentId,
      notes: notes ?? null,
    }),
  });
}

// ─── Validation ─────────────────────────────────────────────────────────────

export interface SCValidationError {
  rule: string;
  code: string;
  severity: string;
  values: Record<string, number | string>;
  explanation: Record<string, string>;
}

/** One garment instance's verdict — for per-garment grouping + re-measure links. */
export interface SCGarmentValidation {
  garment_order_id: string | null;
  garment_id: string | null;
  garment_slug: string | null;
  garment_labels: Record<string, string> | null;
  status: "pass" | "warn" | "block";
  catalog_version: number | null;
  critical_errors: SCValidationError[];
  non_critical_errors: SCValidationError[];
  message: Record<string, string>;
}

export interface SCValidationResult {
  /** Roll-up: worst across garment instances (any block → block, else any warn → warn). */
  status: "pass" | "warn" | "block";
  catalog_version: number | null;
  measurement_job_id: string;
  critical_errors: SCValidationError[];
  non_critical_errors: SCValidationError[];
  message: Record<string, string>;
  /** Per-instance breakdown (empty on old backends). */
  garments?: SCGarmentValidation[];
}

export async function scValidateJob(
  jobId: string,
  garmentOrderId?: string,
): Promise<SCValidationResult> {
  const qs = garmentOrderId
    ? `?garment_order_id=${encodeURIComponent(garmentOrderId)}`
    : "";
  return scFetch<SCValidationResult>(
    `/measurement-jobs/${jobId}/validate${qs}`,
    { method: "POST", auth: false },
  );
}

// ─── Scheduling (availability rules, exceptions, slots, preview) ───────────
// These hit the /captain/* router (different from /style-captain/* jobs router
// above). Same JWT, different prefix.

export interface SCRule {
  id: string;
  style_captain_id: string | null;
  weekday: number | null; // null = daily, 0..6 (0 = Sunday)
  is_closed: boolean | null;
  start_time: string | null; // "HH:MM:SS"
  end_time: string | null;
  valid_from: string | null; // ISO date
  valid_until: string | null;
  is_active: boolean | null;
}

export interface SCException {
  id: string;
  style_captain_id: string | null;
  date: string | null; // ISO date
  type: string | null; // "block"
  start_time: string | null;
  end_time: string | null;
  reason: string | null;
}

export interface SCManualSlot {
  id: string;
  style_captain_id: string | null;
  start_at: string | null; // ISO timestamp
  end_at: string | null;
  status: string | null;
  source: string | null;
}

export interface SCScheduleConfig {
  slot_minutes: number;
  lead_time_minutes: number;
  reschedule_cutoff_minutes: number;
  booking_horizon_days: number;
}

export interface SCNextVisit {
  job_id: string;
  status: string | null;
  scheduled_at: string | null;
  customer_name: string | null;
  order_number: string | null;
}

export interface SCScheduleOverview {
  rules: SCRule[];
  upcoming_exceptions: SCException[];
  upcoming_manual_slots: SCManualSlot[];
  today_bookings_count: number;
  next_visit: SCNextVisit | null;
  config: SCScheduleConfig;
}

export interface SCPreviewSlot {
  start_at: string;
  end_at: string | null;
  status: "open" | "booked" | "buffered" | "manual" | "blocked";
}

export interface SCSchedulePreview {
  from_date: string;
  to_date: string;
  slot_minutes: number;
  slots: SCPreviewSlot[];
}

// — Rule inputs
export interface SCRuleInput {
  weekday: number | null;
  is_closed: boolean;
  start_time?: string | null;
  end_time?: string | null;
  valid_from?: string | null;
  valid_until?: string | null;
  is_active?: boolean;
}

// — Exception inputs
export interface SCExceptionInput {
  date: string; // ISO date
  type?: string; // default "block"
  start_time?: string | null;
  end_time?: string | null;
  reason?: string | null;
}

// — Manual slot inputs
export interface SCManualSlotInput {
  start_at: string; // ISO timestamp
  end_at: string;
}

// — Overview
export async function scFetchScheduleOverview(): Promise<SCScheduleOverview> {
  return scFetch<SCScheduleOverview>("/captain/schedule/overview");
}

// — Preview
export async function scFetchSchedulePreview(
  fromDate?: string,
  toDate?: string,
): Promise<SCSchedulePreview> {
  const qs = new URLSearchParams();
  if (fromDate) qs.set("from_date", fromDate);
  if (toDate) qs.set("to_date", toDate);
  const q = qs.toString() ? `?${qs.toString()}` : "";
  return scFetch<SCSchedulePreview>(`/captain/schedule/preview${q}`);
}

// — Rules CRUD
export async function scListRules(): Promise<SCRule[]> {
  return scFetch<SCRule[]>("/captain/schedule/rules");
}

export async function scCreateRule(input: SCRuleInput): Promise<SCRule> {
  return scFetch<SCRule>("/captain/schedule/rules", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function scUpdateRule(
  ruleId: string,
  input: SCRuleInput,
): Promise<SCRule> {
  return scFetch<SCRule>(`/captain/schedule/rules/${ruleId}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function scDeleteRule(ruleId: string): Promise<void> {
  await scFetch(`/captain/schedule/rules/${ruleId}`, { method: "DELETE" });
}

// — Exceptions CRUD
export async function scListExceptions(
  fromDate?: string,
  toDate?: string,
): Promise<SCException[]> {
  const qs = new URLSearchParams();
  if (fromDate) qs.set("from_date", fromDate);
  if (toDate) qs.set("to_date", toDate);
  const q = qs.toString() ? `?${qs.toString()}` : "";
  return scFetch<SCException[]>(`/captain/schedule/exceptions${q}`);
}

export async function scCreateException(
  input: SCExceptionInput,
): Promise<SCException> {
  return scFetch<SCException>("/captain/schedule/exceptions", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function scUpdateException(
  exceptionId: string,
  input: SCExceptionInput,
): Promise<SCException> {
  return scFetch<SCException>(`/captain/schedule/exceptions/${exceptionId}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function scDeleteException(exceptionId: string): Promise<void> {
  await scFetch(`/captain/schedule/exceptions/${exceptionId}`, {
    method: "DELETE",
  });
}

// — Manual slots CRUD
export async function scListManualSlots(
  fromDate?: string,
  toDate?: string,
): Promise<SCManualSlot[]> {
  const qs = new URLSearchParams();
  if (fromDate) qs.set("from_date", fromDate);
  if (toDate) qs.set("to_date", toDate);
  const q = qs.toString() ? `?${qs.toString()}` : "";
  return scFetch<SCManualSlot[]>(`/captain/schedule/slots${q}`);
}

export async function scCreateManualSlot(
  input: SCManualSlotInput,
): Promise<SCManualSlot> {
  return scFetch<SCManualSlot>("/captain/schedule/slots", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function scDeleteManualSlot(slotId: string): Promise<void> {
  await scFetch(`/captain/schedule/slots/${slotId}`, { method: "DELETE" });
}
