/**
 * Catalog mapping — translates frontend slug IDs to backend UUIDs.
 *
 * The frontend catalog (catalog.ts) uses human-readable slugs like "blouse_cut",
 * "hook", "front" for components, options, and sub-options.
 * The backend uses UUID strings as primary keys.
 *
 * This module fetches the full garment tree from the backend and builds
 * a label-based mapping so that API calls use the correct UUIDs.
 *
 * Matching strategy: compare English labels between frontend catalog and
 * backend catalog tree (case-insensitive, trimmed).
 */

import { ADD_ONS, CATALOG } from "@/lib/catalog";
import { catalogApi } from "@/lib/api";
import type { GarmentTreeOut } from "@/types/api";

export interface CatalogMapping {
  /** garmentId (UUID) */
  garmentId: string;
  /** Maps frontend category.id → backend component UUID */
  componentId: Record<string, string>;
  /** Maps `${categoryId}:${optionId}` → backend variation UUID */
  variationId: Record<string, string>;
  /** Maps `${categoryId}:${optionId}:${subOptionId}` → backend variation_type UUID */
  variationTypeId: Record<string, string>;
  /** Maps frontend addOn.id → backend add-on UUID */
  addOnId: Record<string, string>;
  /** Maps `${addOnId}:${choiceId}` → backend add-on variation UUID */
  addOnVariationId: Record<string, string>;
}

let cachedMapping: CatalogMapping | null = null;

function norm(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * Build a mapping from the backend garment tree by matching labels.
 */
function buildMapping(tree: GarmentTreeOut): CatalogMapping {
  const componentId: Record<string, string> = {};
  const variationId: Record<string, string> = {};
  const variationTypeId: Record<string, string> = {};
  const addOnId: Record<string, string> = {};
  const addOnVariationId: Record<string, string> = {};

  // Map selection components
  for (const cat of CATALOG) {
    const catLabel = norm(cat.label);
    const component = tree.components.find(
      (c) => norm(c.labels?.en ?? "") === catLabel,
    );
    if (!component) continue;
    componentId[cat.id] = component.id;

    for (const opt of cat.options) {
      const optLabel = norm(opt.label);
      const variation = component.variations.find(
        (v) => norm(v.labels?.en ?? "") === optLabel,
      );
      if (!variation) continue;
      variationId[`${cat.id}:${opt.id}`] = variation.id;

      if (opt.subOptions && variation.variation_types.length > 0) {
        for (const sub of opt.subOptions) {
          const subLabel = norm(sub.label);
          const varType = variation.variation_types.find(
            (vt) => norm(vt.labels?.en ?? "") === subLabel,
          );
          if (varType) {
            variationTypeId[`${cat.id}:${opt.id}:${sub.id}`] = varType.id;
          }
        }
      }
    }
  }

  // Map add-ons by matching labels
  const treeAddOns = tree.addons ?? [];
  for (const fa of ADD_ONS) {
    const faLabel = norm(fa.label);
    const backendAo = treeAddOns.find(
      (ba) => norm(ba.labels?.en ?? "") === faLabel,
    );
    if (!backendAo) continue;
    addOnId[fa.id] = backendAo.id;

    // Map choice variations (e.g., Lining Full/Half, Keyhole shapes)
    if (fa.choices && backendAo.variations) {
      for (const choice of fa.choices) {
        const choiceLabel = norm(choice.label);
        const backendVar = backendAo.variations.find(
          (bv) => norm(bv.labels?.en ?? "") === choiceLabel,
        );
        if (backendVar) {
          addOnVariationId[`${fa.id}:${choice.id}`] = backendVar.id;
        }
      }
    }

    // Map placement sizes as variations (e.g., Latkan Small/Medium/Large)
    if (fa.perPlacementSizes && backendAo.variations) {
      for (const size of fa.perPlacementSizes) {
        const sizeLabel = norm(size.label);
        const backendVar = backendAo.variations.find(
          (bv) => norm(bv.labels?.en ?? "") === sizeLabel,
        );
        if (backendVar) {
          addOnVariationId[`${fa.id}:${size.id}`] = backendVar.id;
        }
      }
    }
  }

  return {
    garmentId: tree.id,
    componentId,
    variationId,
    variationTypeId,
    addOnId,
    addOnVariationId,
  };
}

/**
 * Get the catalog mapping, building it from the backend if needed.
 * Cached after first call.
 */
export async function getCatalogMapping(
  garmentId: string,
): Promise<CatalogMapping> {
  if (cachedMapping?.garmentId === garmentId) return cachedMapping;
  const tree = await catalogApi.getGarmentTree(garmentId);
  cachedMapping = buildMapping(tree);
  return cachedMapping;
}

/**
 * Resolve a frontend selection to backend UUIDs.
 * Returns null if mapping isn't available yet.
 */
export function resolveSelection(
  mapping: CatalogMapping,
  categoryId: string,
  optionId: string,
  subOptionId?: string | null,
): {
  componentId: string;
  variationId: string;
  variationTypeId: string | null;
} | null {
  const componentId = mapping.componentId[categoryId];
  if (!componentId) return null;

  const variationId = mapping.variationId[`${categoryId}:${optionId}`];
  if (!variationId) return null;

  let variationTypeId: string | null = null;
  if (subOptionId) {
    variationTypeId =
      mapping.variationTypeId[`${categoryId}:${optionId}:${subOptionId}`] ??
      null;
  }

  return { componentId, variationId, variationTypeId };
}

/** Clear the cache (used by clearDraft). */
export function clearCatalogMappingCache(): void {
  cachedMapping = null;
}

/**
 * Resolve a frontend add-on ID to the backend UUID.
 * Returns null if mapping isn't available.
 */
export function resolveAddOnId(
  mapping: CatalogMapping,
  addOnId: string,
): string | null {
  return mapping.addOnId[addOnId] ?? null;
}

/**
 * Resolve a frontend add-on choice/size to a backend variation UUID.
 * Returns null if not found.
 */
export function resolveAddOnVariationId(
  mapping: CatalogMapping,
  addOnId: string,
  choiceId: string,
): string | null {
  return mapping.addOnVariationId[`${addOnId}:${choiceId}`] ?? null;
}
