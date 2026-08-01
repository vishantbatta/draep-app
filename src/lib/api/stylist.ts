/**
 * AI Stylist API client — powers the /library/call "call a fashion designer" page.
 *
 * GET  /stylist/components       → returns the garment style component tree as text
 * POST /stylist/generate-design  → overlays a described design on the user's photo
 */

import { apiGet, apiPost } from "./client";

export interface StylistComponentsOut {
  component_list: string;
}

export interface GenerateDesignIn {
  image: string; // base64 data URI
  description: string;
}

export interface GenerateDesignOut {
  output_url: string;
}

/** Fetch the garment's style component tree as a text list. */
export function getStylistComponents(): Promise<StylistComponentsOut> {
  return apiGet<StylistComponentsOut>("/stylist/components");
}

/** Generate a design image by overlaying the described design on the user's photo. */
export function generateDesign(
  payload: GenerateDesignIn,
): Promise<GenerateDesignOut> {
  return apiPost<GenerateDesignOut>("/stylist/generate-design", payload);
}
