/**
 * Picker-tree builders for the promo form's bottom sheets.
 *
 * Pure functions: the admin /promotions/options payload + the currently
 * selected keys → a generic PickerNode tree that TieredPickerSheet
 * renders. The cascade smarts live here, not in the component:
 *
 *   garments        — flat selectable leaves (target=garment, combo requires)
 *   components      — garment folders → component leaves (target=component)
 *   variations      — component folders → variation leaves (component narrow),
 *                     scoped to the components the admin already chose
 *   variation types — component → variation folders → type leaves
 *   addons          — flat leaves (target=addon)
 *   addon variations— addon folders → variation leaves, scoped to chosen add-ons
 *   service areas   — flat leaves keyed by id with a city/pincode preview
 */

import type { PromoOptions } from "@/lib/admin-api";
import { formatPrice } from "@/lib/pricing";

export interface PickerNode {
  /** slug for catalog tiers, id for service areas */
  key: string;
  label: string;
  /** price / parent garment / variation count / city+pincodes */
  sublabel?: string;
  selected: boolean;
  /** false = drill-down folder only */
  selectable: boolean;
  children?: PickerNode[];
}

function priceSub(price: number | null | undefined): string | undefined {
  return price == null ? undefined : formatPrice(price);
}

function leaf(
  key: string,
  label: string,
  selected: Set<string>,
  sublabel?: string,
): PickerNode {
  return { key, label, sublabel, selected: selected.has(key), selectable: true };
}

function folder(
  key: string,
  label: string,
  sublabel: string | undefined,
  children: PickerNode[],
): PickerNode {
  return { key, label, sublabel, selected: false, selectable: false, children };
}

/** Flat garment list — also feeds the combo "requires garments" field. */
export function garmentNodes(o: PromoOptions, selected: string[]): PickerNode[] {
  const sel = new Set(selected);
  return o.garments.map((g) => leaf(g.slug, g.label, sel, priceSub(g.price)));
}

/** Garment folders → component leaves. Garments without components drop out. */
export function componentNodes(o: PromoOptions, selected: string[]): PickerNode[] {
  const sel = new Set(selected);
  return o.garments
    .filter((g) => g.children.length > 0)
    .map((g) =>
      folder(
        g.slug,
        g.label,
        priceSub(g.price),
        g.children.map((c) => leaf(c.slug, c.label, sel, `in ${g.label}`)),
      ),
    );
}

/** Component folders → variation leaves, scoped to the chosen components
 * (empty filter = every component that has variations). */
export function variationNodes(
  o: PromoOptions,
  selected: string[],
  componentSlugs: string[],
): PickerNode[] {
  const sel = new Set(selected);
  const wanted = new Set(componentSlugs);
  const folders: PickerNode[] = [];
  for (const g of o.garments) {
    for (const c of g.children) {
      if (c.children.length === 0) continue;
      if (wanted.size > 0 && !wanted.has(c.slug)) continue;
      folders.push(
        folder(c.slug, c.label, `in ${g.label}`, c.children.map((v) => leaf(v.slug, v.label, sel, priceSub(v.price)))),
      );
    }
  }
  return folders;
}

/** Component → variation folders → variation-type leaves. Variations
 * without types are omitted — they have nothing to pick. */
export function variationTypeNodes(
  o: PromoOptions,
  selected: string[],
  componentSlugs: string[],
): PickerNode[] {
  const sel = new Set(selected);
  const wanted = new Set(componentSlugs);
  const folders: PickerNode[] = [];
  for (const g of o.garments) {
    for (const c of g.children) {
      if (wanted.size > 0 && !wanted.has(c.slug)) continue;
      const varFolders = c.children
        .filter((v) => v.children.length > 0)
        .map((v) =>
          folder(
            v.slug,
            v.label,
            priceSub(v.price),
            v.children.map((t) => leaf(t.slug, t.label, sel, priceSub(t.price))),
          ),
        );
      if (varFolders.length > 0)
        folders.push(folder(c.slug, c.label, `in ${g.label}`, varFolders));
    }
  }
  return folders;
}

/** Flat add-on leaves — matrix add-ons show their variation count. */
export function addonNodes(o: PromoOptions, selected: string[]): PickerNode[] {
  const sel = new Set(selected);
  return o.addons.map((a) =>
    leaf(
      a.slug,
      a.label,
      sel,
      a.children.length > 0
        ? `${a.children.length} variation${a.children.length === 1 ? "" : "s"}`
        : priceSub(a.price),
    ),
  );
}

/** Add-on folders → variation leaves, scoped to the chosen add-ons. */
export function addonVariationNodes(
  o: PromoOptions,
  selected: string[],
  addonSlugs: string[],
): PickerNode[] {
  const sel = new Set(selected);
  const wanted = new Set(addonSlugs);
  return o.addons
    .filter((a) => a.children.length > 0 && (wanted.size === 0 || wanted.has(a.slug)))
    .map((a) =>
      folder(
        a.slug,
        a.label,
        priceSub(a.price),
        a.children.map((v) => leaf(v.slug, v.label, sel, priceSub(v.price))),
      ),
    );
}

/** Flat service-area leaves keyed by id (the scope stores ids). */
export function areaNodes(o: PromoOptions, selected: string[]): PickerNode[] {
  const sel = new Set(selected);
  return o.service_areas.map((a) =>
    leaf(
      a.id,
      a.label,
      sel,
      [a.city, a.pincodes.slice(0, 3).join(", ")].filter(Boolean).join(" · ") || undefined,
    ),
  );
}

function matches(n: PickerNode, q: string): boolean {
  const hay = `${n.label} ${n.key} ${n.sublabel ?? ""}`.toLowerCase();
  return hay.includes(q);
}

/** Case-insensitive search over label + key + sublabel. A folder survives
 * if it matches itself (keeping all descendants) or any descendant matches
 * (pruning non-matching siblings). */
export function filterPickerNodes(nodes: PickerNode[], query: string): PickerNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return nodes;
  const walk = (ns: PickerNode[]): PickerNode[] => {
    const out: PickerNode[] = [];
    for (const n of ns) {
      if (matches(n, q)) {
        out.push(n); // self-match keeps the whole subtree
        continue;
      }
      if (n.children) {
        const kids = walk(n.children);
        if (kids.length > 0) out.push({ ...n, children: kids });
      }
    }
    return out;
  };
  return walk(nodes);
}

/** key → label for every node in the tree (folders included). Selected keys
 * missing from the map are stale scope values — callers fall back to the
 * raw key so they stay visible and removable. */
export function selectedLabelMap(nodes: PickerNode[]): Map<string, string> {
  const map = new Map<string, string>();
  const walk = (ns: PickerNode[]) => {
    for (const n of ns) {
      map.set(n.key, n.label);
      if (n.children) walk(n.children);
    }
  };
  walk(nodes);
  return map;
}
