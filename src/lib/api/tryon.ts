/**
 * Virtual try-on API client.
 *
 * POSTs a person photo (multipart) plus the design image URL to /tryon, which
 * calls Gemini 3.6 flash server-side and returns the generated image URL
 * plus AI suggestion tags constrained to the garment's style components.
 *
 * /tryon/refine accepts the current image + a text instruction and returns
 * a new image + fresh suggestions.
 */

import { getToken } from "./client";

export interface TryOnResult {
  output_url: string;
  suggestions: string[];
}

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "/api/v1";

/**
 * Run a virtual try-on.
 *
 * @param file             the user's own photo (a File from <input type=file>)
 * @param designImageUrl   same-origin URL of the design/model image
 * @param garmentId        garment ID for fetching style components for suggestions
 */
export async function tryOn(
  file: File,
  designImageUrl: string,
  garmentId?: string,
): Promise<TryOnResult> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("design_image_url", designImageUrl);
  if (garmentId) formData.append("garment_id", garmentId);

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

  const data = (await res.json()) as TryOnResult;
  return {
    output_url: data.output_url,
    suggestions: data.suggestions ?? [],
  };
}

/**
 * Refine an existing try-on image with a text instruction.
 *
 * @param currentImage  data URI of the current try-on result
 * @param instruction   natural-language modification request
 * @param garmentId     garment ID for fetching style components for suggestions
 */
export async function refineTryOn(
  currentImage: string,
  instruction: string,
  garmentId?: string,
): Promise<TryOnResult> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/tryon/refine`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        current_image: currentImage,
        instruction,
        ...(garmentId ? { garment_id: garmentId } : {}),
      }),
    });
  } catch {
    throw new Error("Could not reach the server. Check your connection and try again.");
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    throw new Error(
      body?.error?.message ?? `Refine failed (${res.status}). Please try again.`,
    );
  }

  const data = (await res.json()) as TryOnResult;
  return {
    output_url: data.output_url,
    suggestions: data.suggestions ?? [],
  };
}
