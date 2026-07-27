/**
 * Design Library API — browse grid, design detail, draft-order.
 * Mirrors be/app/api/design_library.py
 */

import { apiGet, apiPost } from "./client";
import type {
  DraftFromLibraryOut,
  LibraryDetailOut,
  LibraryListOut,
  LibraryListParams,
} from "@/types/api";

// GET /library
//
// Array params (occasion, category, celebrity) are emitted as repeated keys
// (?occasion=Sangeet&occasion=Bridal) so FastAPI parses them into a list.
// The base client's `query` only accepts scalars, so we build the query
// string ourselves here.
export function listLibrary(params: LibraryListParams = {}): Promise<LibraryListOut> {
  const search = new URLSearchParams();
  if (params.limit !== undefined) search.set("limit", String(params.limit));
  if (params.cursor) search.set("cursor", params.cursor);
  if (params.occasion) {
    for (const occ of params.occasion) search.append("occasion", occ);
  }
  if (params.category) {
    for (const cat of params.category) search.append("category", cat);
  }
  if (params.celebrity) {
    for (const cel of params.celebrity) search.append("celebrity", cel);
  }
  const qs = search.toString();
  return apiGet<LibraryListOut>(`/library${qs ? `?${qs}` : ""}`);
}

// GET /library/{library_id}
export function getLibraryDetail(libraryId: string): Promise<LibraryDetailOut> {
  return apiGet<LibraryDetailOut>(`/library/${libraryId}`);
}

// POST /library/{library_id}/draft-order
export function draftFromLibrary(libraryId: string): Promise<DraftFromLibraryOut> {
  return apiPost<DraftFromLibraryOut>(`/library/${libraryId}/draft-order`);
}
