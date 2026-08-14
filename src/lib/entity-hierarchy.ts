// Hierarchy-aware labels for the measurable entity types.
//
// The five linkable entity tables are flat rows with parent-id columns; this
// module loads them once and renders full-path labels like
// "Blouse ▸ Sleeve ▸ Regular short" so admin pickers show where an entity
// lives instead of a bare slug.

import { fetchAll, getLabel, type MeasurableEntityType } from "@/lib/admin-api";

interface CatalogRow {
  id: string;
  slug?: string | null;
  labels?: Record<string, string> | null;
}

interface ComponentRow extends CatalogRow {
  garment_id?: string | null;
}

interface VariationRow extends CatalogRow {
  component_id?: string | null;
}

interface VariationTypeRow extends CatalogRow {
  variation_id?: string | null;
}

interface AddonRow extends CatalogRow {
  garment_id?: string | null;
}

interface AddonVariationRow extends CatalogRow {
  addon_id?: string | null;
}

export interface EntityOption {
  id: string;
  type: MeasurableEntityType;
  /** Full-path label: "Blouse ▸ Sleeve ▸ Regular short". */
  label: string;
  /** Short leaf label (for chips / list rows). */
  shortLabel: string;
  /** The garment this entity ultimately belongs to (null if unresolvable). */
  garmentId: string | null;
  /** Immediate parent id — component for variations, variation for types,
   * garment for add-ons, add-on for add-on variations. */
  parentId: string | null;
  /** The style component this entity sits under (variations + types only). */
  componentId: string | null;
}

/** Style components — an intermediate tier used to filter variation picks. */
export interface ComponentOption {
  id: string;
  label: string;
  garmentId: string | null;
}

export interface EntityHierarchy {
  optionsByType: Record<MeasurableEntityType, EntityOption[]>;
  componentOptions: ComponentOption[];
  optionFor: (
    type: MeasurableEntityType | string | null,
    id: string | null,
  ) => EntityOption | null;
}

export async function loadEntityHierarchy(): Promise<EntityHierarchy> {
  const [garments, components, variations, variationTypes, addons, addonVariations] =
    await Promise.all([
      fetchAll<CatalogRow>("garments"),
      fetchAll<ComponentRow>("garment_style_component"),
      fetchAll<VariationRow>("garment_style_component_variations"),
      fetchAll<VariationTypeRow>("garment_style_component_variation_types"),
      fetchAll<AddonRow>("garment_addons"),
      fetchAll<AddonVariationRow>("garment_addon_variations"),
    ]);

  const byId = <T extends CatalogRow>(rows: T[]) => {
    const m = new Map<string, T>();
    rows.forEach((r) => m.set(r.id, r));
    return m;
  };
  const garmentMap = byId(garments);
  const componentMap = byId(components);
  const variationMap = byId(variations);
  const addonMap = byId(addons);

  const garmentName = (id: string | null | undefined) =>
    id ? (garmentMap.get(id) ? getLabel(garmentMap.get(id)!.labels, garmentMap.get(id)!.slug ?? null, id) : "?") : null;
  const componentName = (id: string | null | undefined) =>
    id ? (componentMap.get(id) ? getLabel(componentMap.get(id)!.labels, componentMap.get(id)!.slug ?? null, id) : "?") : null;

  const garmentOptions: EntityOption[] = garments.map((g) => {
    const short = getLabel(g.labels, g.slug ?? null, g.id);
    return {
      id: g.id,
      type: "garment" as const,
      label: short,
      shortLabel: short,
      garmentId: g.id,
      parentId: null,
      componentId: null,
    };
  });

  const componentOptions: ComponentOption[] = components.map((c) => ({
    id: c.id,
    label: getLabel(c.labels, c.slug ?? null, c.id),
    garmentId: c.garment_id ?? null,
  }));

  // Blouse ▸ Sleeve ▸ Regular short
  const variationOptions: EntityOption[] = variations.map((v) => {
    const comp = v.component_id ? componentMap.get(v.component_id) : undefined;
    const parts = [
      comp?.garment_id ? garmentName(comp.garment_id) : null,
      comp ? componentName(comp.id) : null,
      getLabel(v.labels, v.slug ?? null, v.id),
    ].filter(Boolean);
    return {
      id: v.id,
      type: "variation" as const,
      label: parts.join(" ▸ "),
      shortLabel: parts[parts.length - 1] ?? v.id,
      garmentId: comp?.garment_id ?? null,
      parentId: v.component_id ?? null,
      componentId: v.component_id ?? null,
    };
  });

  // Blouse ▸ Sleeve ▸ Regular ▸ <type>  (variation types are sub-options of a variation)
  const variationTypeOptions: EntityOption[] = variationTypes.map((t) => {
    const v = t.variation_id ? variationMap.get(t.variation_id) : undefined;
    const vOption = v ? variationOptions.find((o) => o.id === v.id) : null;
    const short = getLabel(t.labels, t.slug ?? null, t.id);
    return {
      id: t.id,
      type: "variation_type" as const,
      label: vOption ? `${vOption.label} ▸ ${short}` : short,
      shortLabel: short,
      garmentId: vOption?.garmentId ?? null,
      parentId: t.variation_id ?? null,
      componentId: v?.component_id ?? null,
    };
  });

  // Blouse ▸ Breast cups
  const addonOptions: EntityOption[] = addons.map((a) => {
    const short = getLabel(a.labels, a.slug ?? null, a.id);
    const g = a.garment_id ? garmentName(a.garment_id) : null;
    return {
      id: a.id,
      type: "addon" as const,
      label: g ? `${g} ▸ ${short}` : short,
      shortLabel: short,
      garmentId: a.garment_id ?? null,
      parentId: a.garment_id ?? null,
      componentId: null,
    };
  });

  // Blouse ▸ Breast cups ▸ <variation>
  const addonVariationOptions: EntityOption[] = addonVariations.map((av) => {
    const a = av.addon_id ? addonMap.get(av.addon_id) : undefined;
    const aOption = a ? addonOptions.find((o) => o.id === a.id) : null;
    const short = getLabel(av.labels, av.slug ?? null, av.id);
    return {
      id: av.id,
      type: "addon_variation" as const,
      label: aOption ? `${aOption.label} ▸ ${short}` : short,
      shortLabel: short,
      garmentId: aOption?.garmentId ?? null,
      parentId: av.addon_id ?? null,
      componentId: null,
    };
  });

  const optionsByType: Record<MeasurableEntityType, EntityOption[]> = {
    garment: garmentOptions,
    variation: variationOptions,
    variation_type: variationTypeOptions,
    addon: addonOptions,
    addon_variation: addonVariationOptions,
  };

  const all = new Map<string, EntityOption>();
  Object.values(optionsByType).forEach((opts) =>
    opts.forEach((o) => all.set(`${o.type}:${o.id}`, o)),
  );

  return {
    optionsByType,
    componentOptions,
    optionFor: (type, id) => (type && id ? all.get(`${type}:${id}`) ?? null : null),
  };
}
