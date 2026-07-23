/**
 * Catalog API — garment list, garment tree, single add-on.
 * Mirrors be/app/api/catalog.py
 */

import { apiGet } from "./client";
import type {
  AddonOut,
  GarmentListOut,
  GarmentTreeOut,
} from "@/types/api";

export function listGarments(): Promise<GarmentListOut> {
  return apiGet<GarmentListOut>("/catalog/garments");
}

export function getGarmentTree(garmentId: string): Promise<GarmentTreeOut> {
  return apiGet<GarmentTreeOut>(`/catalog/garments/${garmentId}`);
}

export function getAddon(addonId: string): Promise<AddonOut> {
  return apiGet<AddonOut>(`/catalog/addons/${addonId}`);
}
