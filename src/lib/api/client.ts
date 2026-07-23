/**
 * API client — base fetch wrapper with auth injection + error normalization.
 *
 * Every domain module (auth, catalog, orders, …) imports { apiGet, apiPost, … }
 * which automatically:
 *   1. Prefix the base URL from NEXT_PUBLIC_API_URL
 *   2. Inject Authorization: Bearer <token> from the auth store
 *   3. Set Content-Type: application/json
 *   4. Parse the response or throw ApiError with the backend's error envelope
 */

import type { ApiErrorEnvelope } from "@/types/api";

const BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

// ─── Token management ────────────────────────────────────────────────────────

const TOKEN_KEY = "draep_session_token";

/** Read the current bearer token from localStorage (client-only). */
export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

/** Persist the bearer token (client-only). */
export function setToken(token: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(TOKEN_KEY, token);
}

/** Clear the bearer token (client-only). */
export function clearToken(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(TOKEN_KEY);
}

// ─── Error class ─────────────────────────────────────────────────────────────

export class ApiError extends Error {
  code: string;
  status: number;
  details: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    status: number,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

// ─── Core request function ───────────────────────────────────────────────────

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  /** Extra headers (e.g. Idempotency-Key). */
  headers?: Record<string, string>;
  /** Skip auth header entirely (used by POST /auth/anonymous). */
  skipAuth?: boolean;
  /** Query params for GET requests. */
  query?: Record<string, string | number | boolean | undefined>;
  /**
   * Signal for aborting the request (useful for preventing race conditions
   * when a user rapidly changes selections).
   */
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  const url = `${BASE_URL}${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const {
    method = "GET",
    body,
    headers = {},
    skipAuth = false,
    query,
    signal,
  } = opts;

  const url = buildUrl(path, query);

  const finalHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...headers,
  };

  if (!skipAuth) {
    const token = getToken();
    if (token) {
      finalHeaders["Authorization"] = `Bearer ${token}`;
    }
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: finalHeaders,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (err) {
    // Network error, CORS, offline, etc.
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(
      "network_error",
      "Could not reach the server. Check your connection and try again.",
      0,
    );
  }

  // 204 No Content
  if (response.status === 204) {
    return undefined as T;
  }

  // Parse JSON body
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new ApiError(
      "parse_error",
      "Received an invalid response from the server.",
      response.status,
    );
  }

  // Error envelope
  if (!response.ok) {
    const envelope = json as ApiErrorEnvelope;
    throw new ApiError(
      envelope?.error?.code ?? "unknown_error",
      envelope?.error?.message ?? "An unexpected error occurred.",
      response.status,
      envelope?.error?.details ?? {},
    );
  }

  return json as T;
}

// ─── Convenience verbs ───────────────────────────────────────────────────────

export function apiGet<T>(
  path: string,
  opts?: Omit<RequestOptions, "method" | "body">,
): Promise<T> {
  return request<T>(path, { ...opts, method: "GET" });
}

export function apiPost<T>(
  path: string,
  body?: unknown,
  opts?: Omit<RequestOptions, "method" | "body">,
): Promise<T> {
  return request<T>(path, { ...opts, method: "POST", body });
}

export function apiPut<T>(
  path: string,
  body?: unknown,
  opts?: Omit<RequestOptions, "method" | "body">,
): Promise<T> {
  return request<T>(path, { ...opts, method: "PUT", body });
}

export function apiPatch<T>(
  path: string,
  body?: unknown,
  opts?: Omit<RequestOptions, "method" | "body">,
): Promise<T> {
  return request<T>(path, { ...opts, method: "PATCH", body });
}

export function apiDelete<T>(
  path: string,
  opts?: Omit<RequestOptions, "method" | "body">,
): Promise<T> {
  return request<T>(path, { ...opts, method: "DELETE" });
}
