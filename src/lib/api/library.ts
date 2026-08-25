/**
 * Design Library API — browse grid, design detail, draft-order.
 * Mirrors be/app/api/design_library.py
 */

import { apiGet, apiPost } from "./client";
import type {
  DraftFromLibraryOut,
  LibraryDetailOut,
  LibraryFacetsOut,
  LibraryListOut,
  LibraryListParams,
} from "@/types/api";

// GET /library
//
// Array params (occasion, category, celebrity, body_type, variation,
// variation_type, addon, addon_variation) are emitted as repeated keys
// (?occasion=Sangeet&occasion=Bridal) so FastAPI parses them into a list.
// The base client's `query` only accepts scalars, so we build the query
// string ourselves here.
const ARRAY_KEYS = [
  "occasion",
  "category",
  "celebrity",
  "body_type",
  "variation",
  "variation_type",
  "addon",
  "addon_variation",
] as const;

export function listLibrary(params: LibraryListParams = {}): Promise<LibraryListOut> {
  const search = new URLSearchParams();
  if (params.limit !== undefined) search.set("limit", String(params.limit));
  if (params.cursor) search.set("cursor", params.cursor);
  for (const key of ARRAY_KEYS) {
    for (const v of params[key] ?? []) search.append(key, v);
  }
  const qs = search.toString();
  return apiGet<LibraryListOut>(`/library${qs ? `?${qs}` : ""}`);
}

// GET /library/facets
//
// Filter values derived from the published designs (occasions, body types,
// celebrities) + the full catalogue tree for the style filters.
export function getLibraryFacets(): Promise<LibraryFacetsOut> {
  return apiGet<LibraryFacetsOut>("/library/facets");
}

// GET /library/{library_id}
export function getLibraryDetail(libraryId: string): Promise<LibraryDetailOut> {
  return apiGet<LibraryDetailOut>(`/library/${libraryId}`);
}

// POST /library/{library_id}/draft-order
export function draftFromLibrary(libraryId: string): Promise<DraftFromLibraryOut> {
  return apiPost<DraftFromLibraryOut>(`/library/${libraryId}/draft-order`);
}

// POST /library/{library_id}/order
//
// "Order Now" from a library design — creates a PENDING order (with its
// order_number) straight away; the customer books the visit afterwards at
// /app/orders/{order_id}. NOT idempotent — repeat purchases of the same
// design are legitimate separate orders (the CTA single-flights client-side).
export function orderFromLibrary(libraryId: string): Promise<DraftFromLibraryOut> {
  return apiPost<DraftFromLibraryOut>(`/library/${libraryId}/order`);
}
