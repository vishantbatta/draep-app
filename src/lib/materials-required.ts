// Pure helpers for the "Materials Required" job-PDF section.
//
// The section lists catalog entities chosen in the order whose
// is_material_needed flag is true, so the tailor knows exactly which options
// the customer must bring material for. DOM rendering / measured pagination
// live in job-pdf.ts; only this row-shaping and page-planning logic is pure
// (node-testable, mirroring the helpers it replaces there).

/** Language order used across the job PDF (English first, then natives). */
const LANGS = ["en", "hi", "kn"] as const;

/** Max chars per description line before source-truncation (html2canvas has
 *  no line-clamp — clamp here, exactly like job-pdf's descLines). */
const DESC_MAX = 160;
/** Component blurb clamp, mirroring the style-selections cell. */
const COMP_DESC_MAX = 120;
/** Remark clamp — matches the server's 300-char cap (defensive only). */
const REMARK_MAX = 300;

/** One resolved order-item selection, enriched from the catalog tree by the
 *  caller (see handleGeneratePdf in the admin order page). */
export interface MaterialsRequiredSourceItem {
  garmentOrderId: string;
  /** Display label of the garment this selection belongs to. */
  garmentLabel: string;
  /** True when the selection is an add-on rather than a component variation. */
  isAddon: boolean;
  /** Raw placement from the order item (string or string[]). */
  placement: string | string[] | null;
  /** Labels of the component (or add-on) entity. */
  componentLabels: Record<string, string> | null;
  componentDescriptions: Record<string, string> | null;
  /** Labels of the chosen variation / variation type / add-on variation. */
  choiceLabels: Record<string, string> | null;
  choiceDescriptions: Record<string, string> | null;
  /** Catalog flag of the resolved entity; only strictly-true qualifies. */
  isMaterialNeeded: boolean | null | undefined;
  /** Remark computed by the entity's material_remark_script at PDF time
   *  (POST /admin/material-scripts/preview). Null when the script is
   *  absent, failed, or returned nothing. */
  remark?: string | null;
}

/** A fully-shaped table row for the Materials Required page. */
export interface MaterialsRequiredRow {
  garment: string;
  isAddon: boolean;
  component: string;
  componentNative: string | null;
  componentDescription: string | null;
  choice: string | null;
  choiceNative: string | null;
  placement: string | null;
  descriptions: string[];
  /** Computed "what / how much" line from the entity's script, if any. */
  remark: string | null;
}

function nativeNames(labels: Record<string, string> | null): string | null {
  const natives = LANGS.filter((l) => l !== "en")
    .map((l) => labels?.[l]?.trim())
    .filter((v): v is string => Boolean(v));
  return natives.length > 0 ? natives.join(" · ") : null;
}

function descLines(
  descs: Record<string, string> | null,
  max: number,
): string[] {
  return LANGS.map((l) => descs?.[l]?.trim())
    .filter((v): v is string => Boolean(v))
    .map((v) => (v.length > max ? `${v.slice(0, max - 3)}…` : v));
}

function placementText(p: string | string[] | null): string | null {
  if (Array.isArray(p)) return p.length > 0 ? p.join(", ") : null;
  return p ?? null;
}

function clamp(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 3)}…` : text;
}

/** Filter order selections down to the strictly-flagged ones and shape them
 *  into display rows. Input order is preserved. */
export function toMaterialsRequiredRows(
  items: MaterialsRequiredSourceItem[],
): MaterialsRequiredRow[] {
  const rows: MaterialsRequiredRow[] = [];
  for (const it of items) {
    if (it.isMaterialNeeded !== true) continue;
    const compEn = it.componentLabels?.en?.trim();
    const compDesc = it.componentDescriptions?.en?.trim();
    rows.push({
      garment: it.garmentLabel,
      isAddon: it.isAddon,
      component: compEn || (it.isAddon ? "Add-on" : "Selection"),
      componentNative: nativeNames(it.componentLabels),
      componentDescription: compDesc ? clamp(compDesc, COMP_DESC_MAX) : null,
      choice: it.choiceLabels?.en?.trim() ?? null,
      choiceNative: nativeNames(it.choiceLabels),
      placement: placementText(it.placement),
      descriptions: descLines(it.choiceDescriptions, DESC_MAX),
      remark: it.remark ?? null,
    });
  }
  return rows;
}

/** One Materials Required table row: the entity's details compressed into
 *  crisp columns (item / garment / placement / remark). */
export interface MaterialsChecklistItem {
  /** Choice-led headline: "Hook — Tying mechanism" (component alone when
   *  there is no distinct choice). */
  title: string;
  /** True when the selection is an add-on (drives the badge). */
  isAddon: boolean;
  /** Garment display label — its own table column. */
  garment: string;
  /** Placement text, or null when the item has none — its own column. */
  placement: string | null;
  /** Component + choice native names, deduped and joined. */
  native: string | null;
  /** One-line component blurb. */
  blurb: string | null;
  /** Per-language choice descriptions, English first. */
  descs: string[];
  /** Computed "bring this" line — the Remark column. The server already
   *  truncates; clamp again defensively. */
  remark: string | null;
}

/** Compress a shaped row into the table row's cells. */
export function toChecklistItem(r: MaterialsRequiredRow): MaterialsChecklistItem {
  const title =
    r.choice && r.choice !== r.component ? `${r.choice} — ${r.component}` : r.component;
  const native =
    [...new Set([r.componentNative, r.choiceNative].filter(Boolean))].join(" · ") ||
    null;
  return {
    title,
    isAddon: r.isAddon,
    garment: r.garment,
    placement: r.placement,
    native,
    blurb: r.componentDescription,
    descs: r.descriptions,
    remark: r.remark ? clamp(r.remark, REMARK_MAX) : null,
  };
}

/** Greedy page plan for the Materials Required table: row indices grouped
 *  per page. Every page re-prints the table head (theadHeight); the first
 *  page additionally pays labelHeight once (section label + note). Every
 *  page holds at least one row — a row taller than the whole budget still
 *  gets a page of its own. */
export function planMaterialsPages(
  itemHeights: number[],
  opts: { budget: number; labelHeight: number; theadHeight: number },
): number[][] {
  const pages: number[][] = [];
  let current: number[] = [];
  let used = 0;

  itemHeights.forEach((h, i) => {
    if (current.length > 0 && used + h > opts.budget) {
      pages.push(current);
      current = [];
      used = 0;
    }
    if (current.length === 0) {
      used += opts.theadHeight;
      if (pages.length === 0) used += opts.labelHeight;
    }
    used += h;
    current.push(i);
  });
  if (current.length > 0) pages.push(current);
  return pages;
}
