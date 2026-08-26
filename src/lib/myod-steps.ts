/**
 * MYOD step derivation — builds the guided step-by-step design flow from the
 * live blouse catalog tree (GET /catalog/garments/{id}).
 *
 * Rules (per the confirmed design):
 *   • Each CRITICAL style component (importance === "critical") gets its own step.
 *   • All NON-CRITICAL style components are grouped into a single step.
 *   • All add-ons form the final step.
 *
 * Critical steps are ordered by the curated DESIGN_STEP_ORDER (matching the
 * /design flow: cut → length → front-neck → back → tying), falling back to the
 * component's priority_order for any slug not listed. Non-critical components
 * keep their priority_order within their shared step.
 *
 * A step's options come straight from the component's variations (and their
 * variation_types as sub-options). Selections are tracked as
 * { componentId → { variationId, variationTypeId? } }.
 */

import type {
  AddonOut,
  AddonVariationOut,
  ComponentOut,
  GarmentTreeOut,
  VariationOut,
} from "@/types/api";

/**
 * Curated display order for critical components by slug. Matches the /design
 * flow so the blouse is built cut-first, as the user specified. Components not
 * listed here sort after the listed ones, by their DB priority_order.
 */
const DESIGN_STEP_ORDER: string[] = [
  "blouse_cut",
  "blouse_length",
  "front_neck",
  "back_cut",
  "tying",
];

/** Sort key for a component: curated index if known, else large number + priority. */
function curatedRank(
  slug: string | null | undefined,
  priority: number | null,
): number {
  const idx = slug ? DESIGN_STEP_ORDER.indexOf(slug) : -1;
  if (idx >= 0) return idx;
  return DESIGN_STEP_ORDER.length + (priority ?? Number.MAX_SAFE_INTEGER);
}

/** Label text helper — mirrors the backend `label_text`. */
export function labelText(
  labels: Record<string, string> | null | undefined,
): string {
  if (!labels) return "";
  return labels.en ?? labels.hi ?? Object.values(labels)[0] ?? "";
}

/** Human-readable label for a placement slug (used by placement-specific add-ons). */
export function placementLabel(slug: string): string {
  const map: Record<string, string> = {
    front_neck: "Front neck",
    back_neck: "Back neck",
    sleeves: "Sleeves",
    bottom: "Bottom hem",
  };
  return map[slug] ?? slug.replace(/_/g, " ");
}

/**
 * Build a {slug: label} state dict for the Pyodide SVG renderer, from the
 * current selections. Unselected choice-components fall back to their default
 * option label so the renderer always gets a complete picture. Toggles are
 * included as "on"/"off".
 */
export function buildSvgState(
  steps: DesignStep[],
  selections: Selections,
): Record<string, string> {
  const state: Record<string, string> = {};
  for (const step of steps) {
    for (const comp of step.components) {
      const slug = comp.slug ?? comp.id;
      const sel = selections[comp.id];
      if (comp.kind === "toggle") {
        const on = !!sel && sel.variationId === "__toggle_on__";
        state[slug] = on ? "on" : "off";
        continue;
      }
      // Resolve the chosen variation, else the default, else the first option.
      const chosenId =
        sel?.variationId ?? comp.defaultOptionId ?? comp.options[0]?.id;
      const opt = comp.options.find((o) => o.id === chosenId);
      if (!opt) continue;
      // Use the slug-derived key; for components with sub-types, add a "_type".
      state[slug] = opt.label;
      if (sel?.variationTypeId && opt.subOptions) {
        const sub = opt.subOptions.find((s) => s.id === sel.variationTypeId);
        if (sub) state[`${slug}_type`] = sub.label;
      }
    }
  }
  return state;
}

/** Description text helper — English-first, like labelText. */
export function descText(
  descriptions: Record<string, string> | null | undefined,
): string {
  if (!descriptions) return "";
  return (
    descriptions.en ?? descriptions.hi ?? Object.values(descriptions)[0] ?? ""
  );
}

/** A selectable option within a step (a variation). */
export interface StepOption {
  id: string; // variation id
  label: string;
  /** What this option means (variation description), if available. */
  description?: string;
  /** Reference image URL for this variation (first asset_urls entry), if any. */
  assetUrl?: string;
  /** ADDITIVE price of choosing this option (on top of the base price).
   *  Component variations carry variation.price; add-on variations carry
   *  addon.price + variation.price (precomputed, mirrors the backend
   *  `_resolve_addon_price` additive rule). Undefined = unpriced (adds 0). */
  price?: number;
  /** Raw axis values (where/style/shape/size/type/color) for add-on variations
   *  that decompose along axes — used to resolve chip combinations. */
  axisValues?: Record<string, string>;
  /** Sub-options (variation_types), if any — e.g. Deep → U/V/Round/Square. */
  subOptions?: {
    id: string;
    label: string;
    description?: string;
    /** Reference image for the type (first asset_urls entry), if any. */
    assetUrl?: string;
    /** ADDITIVE price on top of the variation's own price (variation_type.price). */
    price?: number;
  }[];
  /** Pre-selected sub-option id (variation.default_type_id), if any. */
  defaultSubOptionId?: string;
}

/** How a component is chosen. Style components are always single-choice;
 *  add-ons may be a boolean toggle (no variations) or a single choice. */
export type ComponentKind = "choice" | "toggle";

/** One selectable axis of an add-on's variations (e.g. Shape, Size). */
export interface StepAxis {
  key: string; // "where" | "style" | "shape" | "size" | "type" | "color"
  label: string;
  /** Distinct raw values in priority order. */
  values: string[];
}

/** One component group rendered inside a step. */
export interface StepComponent {
  id: string; // component id
  slug?: string; // component slug (e.g. "blouse_cut"), for ordering/keys
  label: string;
  /** What this component decides (component description), if available. */
  description?: string;
  /** Selection style. Defaults to "choice"; add-ons with no variations are "toggle". */
  kind?: ComponentKind;
  /** Reference image for the component/add-on itself (first asset_urls entry).
   *  Carries the thumbnail for bool add-ons, which have no variations/options
   *  to hold an image of their own. */
  assetUrl?: string;
  /** Variation axes for add-ons whose variations decompose along 2+ axes
   *  (e.g. Key Hole: Where · Shape · Size). When set, the extras picker shows
   *  one chip section per axis instead of a flat card per variation. */
  axes?: StepAxis[];
  options: StepOption[];
  /** Pre-selected option id (component.default_variation_id), if any. */
  defaultOptionId?: string;
  /** For toggles: whether it defaults to ON (addon.is_default_on). */
  defaultOn?: boolean;
  /** For placement-specific add-ons (Latkan, Key Hole, Net): allowed placement
   *  slugs (e.g. "front_neck", "back_neck"). When set, the UI asks where to
   *  place the add-on once enabled. */
  placements?: string[];
  /** Logical section for grouping in the extras step (e.g. "Fit", "Add-ons"). */
  section?: string;
  /** Additive price of a toggle add-on (addon.price when it has no variations). */
  price?: number;
}

/** A design step in the guided flow. */
export interface DesignStep {
  /** Stable slug for the step (for keys/analytics), not the route. */
  id: string;
  title: string;
  /** One or more components shown together on this step. */
  components: StepComponent[];
  /**
   * True for the final "extras" step (non-critical components + add-ons
   * merged together). On this step, selecting an option does NOT auto-advance
   * — the user picks as many as they like, then moves on themselves.
   */
  isExtras?: boolean;
  /** Suggested option-grid column count for dense steps (e.g. extras). */
  columns?: 2 | 3;
}

/** One spot of a multi-spot add-on pick: where it goes plus the variation
 *  chosen for that spot. Add-ons priced by placement (a leading "Where"
 *  axis, like Key Hole) can be placed on several spots at once — a key hole
 *  on each sleeve, each with its own shape/size. */
export interface PlacementPick {
  variationId: string;
  variationTypeId?: string;
  /** The spot's where-axis value (a label segment, e.g. "Left Sleeve"). */
  placement: string;
}

/** The user's selection for a single component. Multi-spot add-ons carry
 *  their per-spot choices in `picks` (with `variationId` mirroring the first
 *  pick so single-selection consumers keep working). */
export interface ComponentSelection {
  variationId: string;
  variationTypeId?: string;
  /** For placement-specific add-ons: where it's placed (e.g. "back_neck"). */
  placement?: string;
  /** Per-spot picks of a multi-spot add-on (see PlacementPick). */
  picks?: PlacementPick[];
}

/** All selections: component id → selection. */
export type Selections = Record<string, ComponentSelection>;

/** Add-on selection state (simplified for MYOD): addon id → chosen variation id. */
export type AddonSelections = Record<string, string>;

/** Deep compare of two selections' multi-spot picks (order-sensitive). */
function picksEqual(
  a: PlacementPick[] | undefined,
  b: PlacementPick[] | undefined,
): boolean {
  const pa = a ?? [];
  const pb = b ?? [];
  if (pa.length !== pb.length) return false;
  return pa.every(
    (p, i) =>
      p.variationId === pb[i].variationId &&
      (p.variationTypeId ?? null) === (pb[i].variationTypeId ?? null) &&
      p.placement === pb[i].placement,
  );
}

/**
 * Compare two selections deeply, including sub-types. A component present in
 * one but not the other counts as different. (Full equality — both must have
 * the same set of components selected.)
 */
export function selectionsEqual(a: Selections, b: Selections): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    const sa = a[key];
    const sb = b[key];
    if (!sb) return false;
    if (sa.variationId !== sb.variationId) return false;
    if ((sa.variationTypeId ?? null) !== (sb.variationTypeId ?? null)) {
      return false;
    }
    if (!picksEqual(sa.picks, sb.picks)) return false;
  }
  return true;
}

/**
 * Does `requested` match what `imageState` depicts? If so, skip the refine.
 *
 *  • Choice components: only those the user has SELECTED are compared.
 *    Unselected ones are "use the image's value" → ignored (match). This
 *    supports the incremental one-step-at-a-time flow.
 *  • Toggle components: compared symmetrically — "on" in one and "off"
 *    (absent) in the other counts as a change, so toggling a default-on
 *    add-on off is correctly detected. `toggleIds` identifies which
 *    component ids are boolean toggles.
 */
export function selectionMatchesImage(
  requested: Selections,
  imageState: Selections,
  toggleIds?: Set<string>,
): boolean {
  if (Object.keys(requested).length === 0) return false;
  const sameSelection = (
    a: ComponentSelection | undefined,
    b: ComponentSelection | undefined,
  ) => {
    const aId = a?.variationId ?? null;
    const bId = b?.variationId ?? null;
    if (aId !== bId) return false;
    if ((a?.variationTypeId ?? null) !== (b?.variationTypeId ?? null))
      return false;
    return picksEqual(a?.picks, b?.picks);
  };

  // Selected choice components must match.
  for (const [key, sel] of Object.entries(requested)) {
    if (!sameSelection(sel, imageState[key])) return false;
  }
  // Toggles must match symmetrically (on↔off is a change).
  if (toggleIds) {
    for (const id of toggleIds) {
      if (!sameSelection(requested[id], imageState[id])) return false;
    }
  }
  return true;
}

// ─── Building steps from the tree ──────────────────────────────────────

function componentToStepComponent(c: ComponentOut): StepComponent {
  return {
    id: c.id,
    slug: c.slug ?? undefined,
    label: labelText(c.labels) || c.id,
    description: descText(c.descriptions) || undefined,
    assetUrl: c.asset_urls?.[0] || undefined,
    defaultOptionId: c.default_variation_id ?? undefined,
    options: (c.variations ?? [])
      .slice()
      .sort(byPriority)
      .map(variationToStepOption),
  };
}

function variationToStepOption(v: VariationOut): StepOption {
  const types = (v.variation_types ?? []).slice().sort(byPriority);
  return {
    id: v.id,
    label: labelText(v.labels) || v.id,
    description: descText(v.descriptions) || undefined,
    assetUrl: v.asset_urls?.[0] || undefined,
    ...(v.price != null ? { price: v.price } : {}),
    ...(types.length > 0
      ? {
          subOptions: types.map((t) => ({
            id: t.id,
            label: labelText(t.labels) || t.id,
            description: descText(t.descriptions) || undefined,
            assetUrl: t.asset_urls?.[0] || undefined,
            ...(t.price != null ? { price: t.price } : {}),
          })),
          defaultSubOptionId: v.default_type_id ?? types[0]?.id,
        }
      : {}),
  };
}

function byPriority<T extends { priority_order: number | null }>(
  a: T,
  b: T,
): number {
  const pa = a.priority_order ?? Number.MAX_SAFE_INTEGER;
  const pb = b.priority_order ?? Number.MAX_SAFE_INTEGER;
  return pa - pb;
}

/**
 * Derive the ordered list of design steps from a garment tree.
 *
 * Critical components each get a solo step (in priority order). Non-critical
 * components are merged into one shared step ("Fit & details"). Add-ons form
 * the final step.
 */
export function buildDesignSteps(tree: GarmentTreeOut): DesignStep[] {
  const components = tree.components ?? [];

  const critical = components
    .filter((c) => c.importance === "critical")
    .slice()
    .sort(
      (a, b) =>
        curatedRank(a.slug, a.priority_order) -
        curatedRank(b.slug, b.priority_order),
    );
  const nonCritical = components
    .filter((c) => c.importance !== "critical")
    .slice()
    .sort(byPriority);

  const steps: DesignStep[] = critical.map((c) => ({
    id: c.id,
    title: labelText(c.labels) || c.id,
    components: [componentToStepComponent(c)],
  }));

  // Merge non-critical components AND add-ons into one final "extras" step.
  // It's dense, so it renders in 2 columns, and selecting an option there does
  // NOT auto-advance (the user picks several, then finishes).
  const addons = (tree.addons ?? []).slice().sort(byPriority);
  const extrasComponents = [
    ...nonCritical.map((c) => ({
      ...componentToStepComponent(c),
      section: "Fit",
    })),
    ...addons.map(addonToStepComponent),
  ];
  if (extrasComponents.length > 0) {
    steps.push({
      id: "extras",
      title: "Fit, details & add-ons",
      isExtras: true,
      columns: 2,
      components: extrasComponents,
    });
  }

  return steps;
}

// Order the axis-wizard steps: placement (Where, when the labels decompose)
// comes first (added by addonAxisModel), then style-like axes before
// measurements before color.
const AXIS_FIELDS = [
  { field: "style", label: "Style" },
  { field: "type", label: "Type" },
  { field: "shape", label: "Shape" },
  { field: "size", label: "Size" },
  { field: "color", label: "Color" },
] as const;

/**
 * Derive the variation axes of an add-on: the style/shape/size/type/color
 * fields, plus — when every variation's label is a " · "-separated string like
 * "Front Neck Cut · Round · Small" — the leading design-area segment as a
 * "Where" axis. Axes are only returned when the variations decompose cleanly
 * (every variation has a value on every axis) along TWO OR MORE varying axes —
 * that's when the extras picker switches from a flat card per variation to
 * sectioned per-axis selection. Anything less (single-axis Lining/Latkan, or
 * an oddball variation like Latkan's "Special Latkan" with no axis values)
 * keeps the flat cards so every variation stays reachable.
 */
function addonAxisModel(variations: AddonVariationOut[]): {
  axes: StepAxis[];
  axisValuesOf: (v: AddonVariationOut) => Record<string, string>;
} {
  const fail = { axes: [] as StepAxis[], axisValuesOf: () => ({}) };
  if (variations.length < 2) return fail;
  const segLists = variations.map((v) =>
    addonVariationLabel(v)
      .split("·")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const allMulti = segLists.every((s) => s.length >= 2);
  const valueOf = (
    v: AddonVariationOut,
    i: number,
    key: string,
  ): string | undefined =>
    key === "where"
      ? allMulti
        ? segLists[i][0]
        : undefined
      : ((v as unknown as Record<string, string | null>)[key] ?? undefined);
  const distinct = (vals: (string | undefined)[]): string[] => {
    const out: string[] = [];
    for (const val of vals) if (val && !out.includes(val)) out.push(val);
    return out;
  };

  const axes: StepAxis[] = [];
  if (allMulti) {
    const wheres = distinct(segLists.map((s) => s[0]));
    if (wheres.length > 1)
      axes.push({ key: "where", label: "Where", values: wheres });
  }
  for (const { field, label } of AXIS_FIELDS) {
    const values = distinct(variations.map((v) => valueOf(v, -1, field)));
    if (values.length > 1) axes.push({ key: field, label, values });
  }
  if (axes.length < 2) return fail;
  if (
    !variations.every((v, i) =>
      axes.every((a) => valueOf(v, i, a.key) !== undefined),
    )
  ) {
    return fail;
  }
  return {
    axes,
    axisValuesOf: (v) => {
      const i = variations.indexOf(v);
      return Object.fromEntries(
        axes.map((a) => [a.key, valueOf(v, i, a.key)!]),
      );
    },
  };
}

/** Flatten an add-on into a StepComponent (options = variations, with axis
 *  decomposition when the variations span 2+ axes). Shared by the extras
 *  picker and the /myod/ux playground. */
export function addonToStepComponent(a: AddonOut): StepComponent {
  // Flatten addon variations into options; the axis fields (style/shape/size/...)
  // are surfaced via the variation label. An add-on with no variations is a
  // boolean toggle (on/off); one with variations is a single choice.
  const variations = (a.variations ?? []).slice().sort(byPriority);
  const isToggle = variations.length === 0;
  const { axes, axisValuesOf } = addonAxisModel(variations);
  return {
    id: a.id,
    label: labelText(a.labels) || a.id,
    description: descText(a.descriptions) || undefined,
    assetUrl: a.asset_urls?.[0] || undefined,
    kind: isToggle ? "toggle" : "choice",
    defaultOn: a.is_default_on ?? undefined,
    defaultOptionId: a.default_variation_id ?? undefined,
    placements: (a.placements ?? undefined)?.filter(Boolean),
    section: "Add-ons",
    ...(a.price != null ? { price: a.price } : {}),
    ...(axes.length > 0 ? { axes } : {}),
    options: variations.map((v) => ({
      id: v.id,
      label: addonVariationLabel(v),
      description: descText(v.descriptions) || undefined,
      assetUrl: v.asset_urls?.[0] || undefined,
      // Additive per the backend `_resolve_addon_price`: the add-on's base
      // price PLUS the variation's own price (e.g. Latkan ₹80 + Small ₹100).
      price: (a.price ?? 0) + (v.price ?? 0),
      ...(axes.length > 0 ? { axisValues: axisValuesOf(v) } : {}),
    })),
  };
}

function addonVariationLabel(v: AddonVariationOut): string {
  const base = labelText(v.labels);
  if (base) return base;
  // Fall back to the axis fields if no label.
  const axis = [v.style, v.shape, v.size, v.type, v.color].filter(Boolean);
  return axis.join(" ") || v.id;
}

// ─── Brief + change text generation ────────────────────────────────────

/**
 * Build the human-readable running design brief from the current selections.
 * Used as the `current_config`/`new_config` sent to /myod/svg-edit so the model
 * stays grounded across steps. Each line includes the component description,
 * the chosen option, and the option/sub-type descriptions so the model
 * understands what every choice means — not just its label.
 *
 * Example line:
 *   "Front neck cut: Round (How the neckline… frames your face) — A smooth
 *    half-circle, sits close to the base of the neck."
 */
export function buildDesignBrief(
  steps: DesignStep[],
  selections: Selections,
): string {
  const parts: string[] = [];
  for (const step of steps) {
    for (const comp of step.components) {
      const sel = selections[comp.id];
      // Boolean toggle: present = on, absent = off.
      if (comp.kind === "toggle") {
        const on = !!sel && sel.variationId === "__toggle_on__";
        let line = `${comp.label}: ${on ? "on" : "off"}`;
        if (comp.description) line += ` (${comp.description})`;
        parts.push(line);
        continue;
      }
      if (!sel) continue;
      // Multi-spot add-on: one line per spot (the option label already names
      // the spot, e.g. "Key hole: Left Sleeve · Bow · Small").
      if (sel.picks && sel.picks.length > 0) {
        for (const pick of sel.picks) {
          const option = comp.options.find((o) => o.id === pick.variationId);
          if (!option) continue;
          parts.push(describeLine(comp, option, pick.variationTypeId));
        }
        continue;
      }
      const option = comp.options.find((o) => o.id === sel.variationId);
      if (!option) continue;
      let line = describeLine(comp, option, sel.variationTypeId);
      if (sel.placement)
        line += ` — placed at ${placementLabel(sel.placement)}`;
      parts.push(line);
    }
  }
  return parts.join("\n");
}

/** Render one component→option line with descriptions. */
function describeLine(
  comp: StepComponent,
  option: StepOption,
  subId?: string,
): string {
  // Value = option label (+ sub-type label if any).
  const sub = subId
    ? option.subOptions?.find((s) => s.id === subId)
    : undefined;
  const value = sub ? `${option.label} (${sub.label})` : option.label;

  let line = `${comp.label}: ${value}`;
  if (comp.description) line += ` (${comp.description})`;
  // Option description, then sub-type description if present.
  const descs = [option.description, sub?.description].filter(Boolean);
  if (descs.length) line += ` — ${descs.join(" ")}`;
  return line;
}

/** Short value-only rendering (label, + sub-type label). */
function describeOption(option: StepOption, subId?: string): string {
  if (option.subOptions && option.subOptions.length > 0) {
    const sub = subId
      ? option.subOptions.find((s) => s.id === subId)
      : undefined;
    return sub ? `${option.label}, ${sub.label}` : option.label;
  }
  return option.label;
}

/**
 * Build the human-readable description of a single selection (the
 * `change_description` for /myod/svg-edit). Example: "Front neck cut → Deep, V-shape".
 */
export function describeSelection(
  step: DesignStep,
  componentId: string,
  selection: ComponentSelection,
): string {
  const comp = step.components.find((c) => c.id === componentId);
  if (!comp) return "";
  // Boolean toggle ON.
  if (selection.variationId === "__toggle_on__") {
    return `${comp.label} → on`;
  }
  // Multi-spot add-on: name every spot's combination.
  if (selection.picks && selection.picks.length > 0) {
    const spots = selection.picks
      .map((pick) => {
        const option = comp.options.find((o) => o.id === pick.variationId);
        return option ? describeOption(option, pick.variationTypeId) : null;
      })
      .filter(Boolean);
    if (spots.length === 0) return "";
    return `${comp.label} → ${spots.join("; ")}`;
  }
  const option = comp.options.find((o) => o.id === selection.variationId);
  if (!option) return "";
  const value = describeOption(option, selection.variationTypeId);
  // Include the chosen option's description so the model knows what the change
  // means visually (e.g. princess cut = vertical bust-to-hem seams).
  let line = `${comp.label} → ${value}`;
  if (option.description) line += ` (${option.description})`;
  return line;
}

/**
 * True if every SELECTED component matches its default option (and default
 * sub-type). Unselected components are ignored. (Utility; the live skip-refine
 * check uses `selectionMatchesImage` against the image's tracked state.)
 */
export function isSelectionAllDefaults(
  steps: DesignStep[],
  selections: Selections,
): boolean {
  if (Object.keys(selections).length === 0) return false;
  const stepComps = steps.flatMap((s) => s.components);
  for (const comp of stepComps) {
    const sel = selections[comp.id];
    if (!sel) continue; // unchosen — ignore
    if (sel.variationId !== comp.defaultOptionId) return false;
    const defOpt = comp.options.find((o) => o.id === comp.defaultOptionId);
    if (defOpt?.subOptions && defOpt.subOptions.length > 0) {
      if (sel.variationTypeId !== defOpt.defaultSubOptionId) return false;
    }
  }
  return true;
}

// ─── Live pricing (mirrors app/core/pricing.py) ────────────────────────

/** One priced row of the running total: what was chosen and what it adds. */
export interface MyodPriceLine {
  label: string;
  amount: number;
}

/**
 * Additive amount ONE selection contributes (0 when unpriced/off):
 *  - toggle on  → the add-on's base price
 *  - picks      → sum of every spot's (precomputed) option price — the
 *                 backend stores one order item per spot, each resolving
 *                 addon.price + variation.price, so the sum matches exactly
 *  - choice     → variation price + the selected (else default) sub-type price
 * Same rules as `compute_price_for_order` applies per order item.
 */
export function selectionAmount(
  comp: StepComponent,
  sel: ComponentSelection | undefined,
): number {
  if (!sel || sel.variationId === "__off__") return 0;
  if (sel.variationId === "__toggle_on__") return comp.price ?? 0;
  if (sel.picks?.length) {
    return sel.picks.reduce((sum, p) => {
      const opt = comp.options.find((o) => o.id === p.variationId);
      return sum + (opt?.price ?? 0);
    }, 0);
  }
  const opt = comp.options.find((o) => o.id === sel.variationId);
  if (!opt) return 0;
  const subId = sel.variationTypeId ?? opt.defaultSubOptionId;
  const sub = subId ? opt.subOptions?.find((s) => s.id === subId) : undefined;
  return (opt.price ?? 0) + (sub?.price ?? 0);
}

/**
 * Running total for the wizard: garment base price plus one line per priced
 * selection, in step order. Mirrors the breakdown the created order will
 * carry (base + additive variation/type/add-on prices; unpriced adds 0).
 */
export function computeSelectionPrice(
  steps: DesignStep[],
  selections: Selections,
  basePrice: number | null,
): { base: number; lines: MyodPriceLine[]; total: number } {
  const base = basePrice ?? 0;
  const lines: MyodPriceLine[] = [];
  let extras = 0;
  for (const step of steps) {
    for (const comp of step.components) {
      const sel = selections[comp.id];
      const amount = selectionAmount(comp, sel);
      if (!amount) continue;
      extras += amount;
      lines.push({ label: priceLineLabel(comp, sel), amount });
    }
  }
  return { base, lines, total: base + extras };
}

/** "Sleeve style: Regular short" / "Key Hole: Back · Round · Small +2 more". */
function priceLineLabel(
  comp: StepComponent,
  sel: ComponentSelection,
): string {
  if (sel.variationId === "__toggle_on__") return `${comp.label}: on`;
  if (sel.picks?.length) {
    const first = comp.options.find((o) => o.id === sel.picks![0].variationId);
    const value = first
      ? sel.picks.length > 1
        ? `${first.label} +${sel.picks.length - 1} more`
        : first.label
      : "on";
    return `${comp.label}: ${value}`;
  }
  const opt = comp.options.find((o) => o.id === sel.variationId);
  if (!opt) return `${comp.label}: on`;
  const subId = sel.variationTypeId ?? opt.defaultSubOptionId;
  const sub = subId ? opt.subOptions?.find((s) => s.id === subId) : undefined;
  return `${comp.label}: ${sub ? `${opt.label} · ${sub.label}` : opt.label}`;
}
