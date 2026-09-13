/**
 * Applies-to target rows — the combo-style picker rows on the promo form.
 *
 * One row is one flat list of catalog picks (any tier, same sheet as combo
 * requirements) and EVERY picked thing gets the discount: garment picks
 * discount whole garment lines, variation/type picks discount those
 * selection lines, add-on picks discount add-on lines. No tier filters
 * another — picking Blouse and Lining discounts both, exactly like combo
 * requirement picks coexist in one row.
 *
 * Rows only group picks for the sheet UI; the engine discounts every group
 * independently, so "applies to entity 1 AND entity 2" = both in the list
 * (one row or two) — both get discounted when both are in the cart.
 */

import type { PromoTargetGroup, PromotionScope } from "@/lib/admin-api";
import { bucketSelection } from "@/lib/promo-requires";

export interface TargetGroupDraft {
  garmentSlugs: string; // CSV
  componentSlugs: string;
  variationSlugs: string;
  variationTypeSlugs: string;
  addonSlugs: string;
  addonVariationSlugs: string;
}

export const EMPTY_TARGET_GROUP: TargetGroupDraft = {
  garmentSlugs: "",
  componentSlugs: "",
  variationSlugs: "",
  variationTypeSlugs: "",
  addonSlugs: "",
  addonVariationSlugs: "",
};

/** One engine group inside scope.targets (imported from admin-api so the
 * wire type and the row mapper can never drift). */
export type { PromoTargetGroup } from "@/lib/admin-api";

function csv(s: string): string[] {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x !== "");
}

function join(list: string[] | undefined | null): string {
  return (list ?? []).join(", ");
}

/** Any non-empty pick anywhere? Empty "Add target" rows never count. */
export function targetRowsHavePicks(rows: TargetGroupDraft[]): boolean {
  return rows.some(
    (r) =>
      csv(r.garmentSlugs).length > 0 ||
      csv(r.componentSlugs).length > 0 ||
      csv(r.variationSlugs).length > 0 ||
      csv(r.variationTypeSlugs).length > 0 ||
      csv(r.addonSlugs).length > 0 ||
      csv(r.addonVariationSlugs).length > 0,
  );
}

/** Rows → scope.targets groups. Flat-list semantics: each tier's picks
 * become that tier's group — no tier narrows another. */
export function targetRowsToScope(rows: TargetGroupDraft[]): PromoTargetGroup[] {
  const groups: PromoTargetGroup[] = [];
  for (const r of rows) {
    const gs = csv(r.garmentSlugs);
    const cs = csv(r.componentSlugs);
    const vs = csv(r.variationSlugs);
    const vts = csv(r.variationTypeSlugs);
    const asl = csv(r.addonSlugs);
    const avs = csv(r.addonVariationSlugs);

    if (gs.length) groups.push({ target: "garment", garment_slugs: gs });
    if (cs.length || vs.length || vts.length) {
      const g: PromoTargetGroup = { target: "component" };
      if (cs.length) g.component_slugs = cs;
      if (vs.length) g.variation_slugs = vs;
      if (vts.length) g.variation_type_slugs = vts;
      groups.push(g);
    }
    if (asl.length || avs.length) {
      const g: PromoTargetGroup = { target: "addon" };
      if (asl.length) g.addon_slugs = asl;
      if (avs.length) g.addon_variation_slugs = avs;
      groups.push(g);
    }
  }
  return groups;
}

/**
 * scope → editable rows. New shape: one row per engine group. Legacy flat
 * scopes become a single row; whole-order scopes become no rows. A legacy
 * garment_slugs narrower on a component group re-opens as garment +
 * component picks in one row — re-saving then discounts both tiers
 * (flat-list semantics; the narrower is dropped, which the old admin form
 * could never produce anyway).
 */
export function scopeToTargetRows(
  scope: PromotionScope | null | undefined,
): TargetGroupDraft[] {
  const s = scope ?? {};
  if (Array.isArray(s.targets) && s.targets.length > 0) {
    return s.targets.map((g) => ({
      garmentSlugs: join(g.garment_slugs),
      componentSlugs: join(g.component_slugs),
      variationSlugs: join(g.variation_slugs),
      variationTypeSlugs: join(g.variation_type_slugs),
      addonSlugs: join(g.addon_slugs),
      addonVariationSlugs: join(g.addon_variation_slugs),
    }));
  }
  const target = (s.target as string) ?? "order";
  if (target === "order") return [];
  return [
    {
      garmentSlugs: join(s.garment_slugs),
      componentSlugs: join(s.component_slugs),
      variationSlugs: join(s.variation_slugs),
      variationTypeSlugs: join(s.variation_type_slugs),
      addonSlugs: join(s.addon_slugs),
      addonVariationSlugs: join(s.addon_variation_slugs),
    },
  ];
}

/** Sheet selection → a target row — bucketSelection for the applies-to
 * sheet (same tier walk as combo rows, minQty stripped). */
export function bucketTargetRow(
  o: Parameters<typeof bucketSelection>[0],
  keys: string[],
  prev?: TargetGroupDraft,
): TargetGroupDraft {
  const g = bucketSelection(o, keys, prev ? { ...prev, minQty: "1" } : undefined);
  return {
    garmentSlugs: g.garmentSlugs,
    componentSlugs: g.componentSlugs,
    variationSlugs: g.variationSlugs,
    variationTypeSlugs: g.variationTypeSlugs,
    addonSlugs: g.addonSlugs,
    addonVariationSlugs: g.addonVariationSlugs,
  };
}
