/**
 * Virtual try-on API client.
 *
 * POSTs a person photo (multipart) plus the design image URL to /tryon, which
 * calls Replicate's flux-2-klein-4b model server-side and returns the generated
 * image URL.
 *
 * The endpoint is same-origin (proxied to the backend via next.config.mjs).
 * We deliberately bypass the JSON api/client.ts wrapper because this request is
 * multipart/form-data, not JSON.
 */

import { getToken } from "./client";

export interface TryOnResult {
  output_url: string;
}

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "/api/v1";

/**
 * Run a virtual try-on.
 *
 * @param file       the user's own photo (a File from <input type=file>)
 * @param designImageUrl  same-origin URL of the design/model image
 *                        (e.g. "/designs/abc_hero.jpg")
 */
export async function tryOn(
  file: File,
  designImageUrl: string,
): Promise<TryOnResult> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("design_image_url", designImageUrl);

  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  // NOTE: do NOT set Content-Type — the browser sets it with the correct
  // multipart boundary when we pass FormData as the body.

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/tryon`, {
      method: "POST",
      headers,
      body: formData,
    });
  } catch {
    throw new Error("Could not reach the server. Check your connection and try again.");
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    throw new Error(
      body?.error?.message ?? `Try-on failed (${res.status}). Please try again.`,
    );
  }

  return (await res.json()) as TryOnResult;
}
