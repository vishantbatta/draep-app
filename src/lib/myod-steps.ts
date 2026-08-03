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
export function labelText(labels: Record<string, string> | null | undefined): string {
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
      const chosenId = sel?.variationId ?? comp.defaultOptionId ?? comp.options[0]?.id;
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
  return descriptions.en ?? descriptions.hi ?? Object.values(descriptions)[0] ?? "";
}

/** A selectable option within a step (a variation). */
export interface StepOption {
  id: string; // variation id
  label: string;
  /** What this option means (variation description), if available. */
  description?: string;
  /** Sub-options (variation_types), if any — e.g. Deep → U/V/Round/Square. */
  subOptions?: { id: string; label: string; description?: string }[];
  /** Pre-selected sub-option id (variation.default_type_id), if any. */
  defaultSubOptionId?: string;
}

/** How a component is chosen. Style components are always single-choice;
 *  add-ons may be a boolean toggle (no variations) or a single choice. */
export type ComponentKind = "choice" | "toggle";

/** One component group rendered inside a step. */
export interface StepComponent {
  id: string; // component id
  slug?: string; // component slug (e.g. "blouse_cut"), for ordering/keys
  label: string;
  /** What this component decides (component description), if available. */
  description?: string;
  /** Selection style. Defaults to "choice"; add-ons with no variations are "toggle". */
  kind?: ComponentKind;
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

/** The user's selection for a single component. */
export interface ComponentSelection {
  variationId: string;
  variationTypeId?: string;
  /** For placement-specific add-ons: where it's placed (e.g. "back_neck"). */
  placement?: string;
}

/** All selections: component id → selection. */
export type Selections = Record<string, ComponentSelection>;

/** Add-on selection state (simplified for MYOD): addon id → chosen variation id. */
export type AddonSelections = Record<string, string>;

/**
 * Compare two selections deeply, including sub-types. A component present in
 * one but not the other counts as different. (Full equality — both must have
 * the same set of components selected.)
 */
export function selectionsEqual(
  a: Selections,
  b: Selections,
): boolean {
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
  const sameSelection = (a: ComponentSelection | undefined, b: ComponentSelection | undefined) => {
    const aId = a?.variationId ?? null;
    const bId = b?.variationId ?? null;
    if (aId !== bId) return false;
    return (a?.variationTypeId ?? null) === (b?.variationTypeId ?? null);
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
    ...(types.length > 0
      ? {
          subOptions: types.map((t) => ({
            id: t.id,
            label: labelText(t.labels) || t.id,
            description: descText(t.descriptions) || undefined,
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
    .sort((a, b) => curatedRank(a.slug, a.priority_order) - curatedRank(b.slug, b.priority_order));
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
    ...nonCritical.map((c) => ({ ...componentToStepComponent(c), section: "Fit" })),
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

function addonToStepComponent(a: AddonOut): StepComponent {
  // Flatten addon variations into options; the axis fields (style/shape/size/...)
  // are surfaced via the variation label. An add-on with no variations is a
  // boolean toggle (on/off); one with variations is a single choice.
  const variations = (a.variations ?? []).slice().sort(byPriority);
  const isToggle = variations.length === 0;
  return {
    id: a.id,
    label: labelText(a.labels) || a.id,
    description: descText(a.descriptions) || undefined,
    kind: isToggle ? "toggle" : "choice",
    defaultOn: a.is_default_on ?? undefined,
    defaultOptionId: a.default_variation_id ?? undefined,
    placements: (a.placements ?? undefined)?.filter(Boolean),
    section: "Add-ons",
    options: variations.map((v) => ({
      id: v.id,
      label: addonVariationLabel(v),
      description: descText(v.descriptions) || undefined,
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
 * Used as the `design_brief` sent to /myod/create and /myod/refine so the model
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
      const option = comp.options.find((o) => o.id === sel.variationId);
      if (!option) continue;
      let line = describeLine(comp, option, sel.variationTypeId);
      if (sel.placement) line += ` — placed at ${placementLabel(sel.placement)}`;
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
  const sub = subId ? option.subOptions?.find((s) => s.id === subId) : undefined;
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
 * Build the human-readable description of a single selection (the `change`
 * for /myod/refine). Example: "Front neck cut → Deep, V-shape".
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
