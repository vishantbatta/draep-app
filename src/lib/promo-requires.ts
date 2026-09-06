/**
 * Combo requirement groups (group M) — the "cart must contain …" rows on
 * the promo form.
 *
 * A group is one conjunction of catalog filters; every group must hold for
 * the promo to apply ("get both sleeveless and V-shape front neck → ₹100
 * off" = two leaf groups). The requirement sheet shows the whole catalog
 * with EVERY tier selectable — picking "Sleeveless" inside Blouse → Sleeve
 * style means "a garment with sleeve = sleeveless".
 *
 * The draft stores tier-bucketed CSVs (so buildScope stays pure — no
 * options payload needed); the sheet returns a flat slug list that
 * bucketSelection re-classifies by walking the options tree.
 */

import type { PromoOptions, PromotionRequiresGroup } from "@/lib/admin-api";
import { formatPrice } from "@/lib/pricing";
import type { PickerNode } from "@/lib/promo-pickers";

export interface RequireGroupDraft {
  garmentSlugs: string; // CSV
  componentSlugs: string;
  variationSlugs: string;
  variationTypeSlugs: string;
  addonSlugs: string;
  addonVariationSlugs: string;
  minQty: string;
}

export const EMPTY_REQUIRE_GROUP: RequireGroupDraft = {
  garmentSlugs: "",
  componentSlugs: "",
  variationSlugs: "",
  variationTypeSlugs: "",
  addonSlugs: "",
  addonVariationSlugs: "",
  minQty: "1",
};

type Bucket = Exclude<keyof RequireGroupDraft, "minQty">;

const BUCKETS: Bucket[] = [
  "garmentSlugs",
  "componentSlugs",
  "variationSlugs",
  "variationTypeSlugs",
  "addonSlugs",
  "addonVariationSlugs",
];

const SNAKE: Record<
  Bucket,
  | "garment_slugs"
  | "component_slugs"
  | "variation_slugs"
  | "variation_type_slugs"
  | "addon_slugs"
  | "addon_variation_slugs"
> = {
  garmentSlugs: "garment_slugs",
  componentSlugs: "component_slugs",
  variationSlugs: "variation_slugs",
  variationTypeSlugs: "variation_type_slugs",
  addonSlugs: "addon_slugs",
  addonVariationSlugs: "addon_variation_slugs",
};

function csv(s: string): string[] {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x !== "");
}

function join(list: string[]): string {
  return list.join(", ");
}

/** Every slug in the group across tiers — the sheet's selection + chips. */
export function requireGroupSlugs(g: RequireGroupDraft): string[] {
  return BUCKETS.flatMap((b) => csv(g[b]));
}

/** Draft rows → scope.requires. Groups without a single slug are dropped —
 * an untouched "Add requirement" row never blocks submit. */
export function requireGroupsToScope(
  groups: RequireGroupDraft[],
): PromotionRequiresGroup[] {
  const out: PromotionRequiresGroup[] = [];
  for (const g of groups) {
    const row: PromotionRequiresGroup = {
      min_qty: Math.max(1, parseInt(g.minQty, 10) || 1),
    };
    let any = false;
    for (const b of BUCKETS) {
      const list = csv(g[b]);
      if (list.length) {
        row[SNAKE[b]] = list;
        any = true;
      }
    }
    if (any) out.push(row);
  }
  return out;
}

/** scope.requires → editable rows (stale slugs ride along in their bucket). */
export function scopeToRequireGroups(scope: {
  requires?: PromotionRequiresGroup[] | null;
}): RequireGroupDraft[] {
  return (scope.requires ?? []).map((r) => ({
    garmentSlugs: join(r.garment_slugs ?? []),
    componentSlugs: join(r.component_slugs ?? []),
    variationSlugs: join(r.variation_slugs ?? []),
    variationTypeSlugs: join(r.variation_type_slugs ?? []),
    addonSlugs: join(r.addon_slugs ?? []),
    addonVariationSlugs: join(r.addon_variation_slugs ?? []),
    minQty: String(r.min_qty ?? 1),
  }));
}

function tierMap(o: PromoOptions): Map<string, Bucket> {
  const m = new Map<string, Bucket>();
  for (const g of o.garments) {
    m.set(g.slug, "garmentSlugs");
    for (const c of g.children) {
      m.set(c.slug, "componentSlugs");
      for (const v of c.children) {
        m.set(v.slug, "variationSlugs");
        for (const t of v.children) m.set(t.slug, "variationTypeSlugs");
      }
    }
  }
  for (const a of o.addons) {
    m.set(a.slug, "addonSlugs");
    for (const v of a.children) m.set(v.slug, "addonVariationSlugs");
  }
  return m;
}

/** Flat sheet selection → tier buckets. Keys the catalog no longer knows
 * keep their previous bucket (edit round-trips lose nothing); brand-new
 * unknowns land in the garment bucket — behaviorally identical, since an
 * unknown slug matches nothing wherever it sits. */
export function bucketSelection(
  o: PromoOptions,
  keys: string[],
  prev?: RequireGroupDraft,
): RequireGroupDraft {
  const tiers = tierMap(o);
  const prevBucket = new Map<string, Bucket>();
  if (prev) {
    for (const b of BUCKETS) for (const k of csv(prev[b])) prevBucket.set(k, b);
  }
  const next = {
    garmentSlugs: [] as string[],
    componentSlugs: [] as string[],
    variationSlugs: [] as string[],
    variationTypeSlugs: [] as string[],
    addonSlugs: [] as string[],
    addonVariationSlugs: [] as string[],
  };
  for (const k of keys) {
    const b = tiers.get(k) ?? prevBucket.get(k) ?? "garmentSlugs";
    next[b].push(k);
  }
  return {
    ...next,
    garmentSlugs: join(next.garmentSlugs),
    componentSlugs: join(next.componentSlugs),
    variationSlugs: join(next.variationSlugs),
    variationTypeSlugs: join(next.variationTypeSlugs),
    addonSlugs: join(next.addonSlugs),
    addonVariationSlugs: join(next.addonVariationSlugs),
    minQty: prev?.minQty ?? "1",
  };
}

function priceSub(price: number | null | undefined): string | undefined {
  return price == null ? undefined : formatPrice(price);
}

/** The full catalog as one requirement tree — every tier selectable (the
 * check circle on a folder selects it; tapping the row drills).
 *
 * Add-ons nest under their parent garment (matching the catalogue view:
 * "style components and add-ons for this garment"); add-ons without a
 * garment stay at the top level. */
export function requirementNodes(o: PromoOptions, selected: string[]): PickerNode[] {
  const sel = new Set(selected);
  const selLeaf = (key: string, label: string, sublabel?: string): PickerNode => ({
    key,
    label,
    sublabel,
    selected: sel.has(key),
    selectable: true,
  });
  const garmentSlugs = new Set(o.garments.map((g) => g.slug));
  const addonsByGarment = new Map<string, PromoOptions["addons"]>();
  const globalAddons: PromoOptions["addons"] = [];
  for (const a of o.addons) {
    if (a.garment_slug && garmentSlugs.has(a.garment_slug)) {
      const siblings = addonsByGarment.get(a.garment_slug);
      if (siblings) siblings.push(a);
      else addonsByGarment.set(a.garment_slug, [a]);
    } else {
      globalAddons.push(a);
    }
  }
  const addonSub = (a: PromoOptions["addons"][number], nested: boolean): string => {
    const detail =
      a.children.length > 0
        ? `${a.children.length} variation${a.children.length === 1 ? "" : "s"}`
        : (priceSub(a.price) ?? "");
    return nested && detail ? `Add-on · ${detail}` : detail || (nested ? "Add-on" : "");
  };
  const addonFolder = (a: PromoOptions["addons"][number], nested: boolean): PickerNode => ({
    key: a.slug,
    label: a.label,
    sublabel: addonSub(a, nested),
    selected: sel.has(a.slug),
    selectable: true, // "any latkan line"
    children: a.children.map((v) => selLeaf(v.slug, v.label, priceSub(v.price))),
  });
  const garmentFolder = (g: PromoOptions["garments"][number]): PickerNode => ({
    key: g.slug,
    label: g.label,
    sublabel: priceSub(g.price),
    selected: sel.has(g.slug),
    selectable: true, // a folder AND a pickable requirement ("any blouse")
    children: [
      ...g.children.map((c) => ({
        key: c.slug,
        label: c.label,
        sublabel: `in ${g.label}`,
        selected: sel.has(c.slug),
        selectable: true, // "a garment with any sleeve configured"
        children: c.children.map((v) => ({
          key: v.slug,
          label: v.label,
          sublabel: priceSub(v.price),
          selected: sel.has(v.slug),
          selectable: true, // "sleeve = sleeveless"
          children: v.children.map((t) => selLeaf(t.slug, t.label, priceSub(t.price))),
        })),
      })),
      ...(addonsByGarment.get(g.slug) ?? []).map((a) => addonFolder(a, true)),
    ],
  });
  return [
    ...o.garments.map(garmentFolder),
    ...globalAddons.map((a) => addonFolder(a, false)),
  ];
}
