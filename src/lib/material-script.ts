// Pure helpers for the material-remark script feature.
//
// A material remark script is a small Python snippet authored in the
// catalogue editor and executed on the SERVER (POST /admin/material-scripts/
// preview — see be/app/services/material_script.py). This module holds the
// browser-side logic around it: which measurement variables a script reads
// (drives the editor's test form), turning filled form fields into the
// preview payload, turning an order's saved readings into the same payload
// shape, and picking the most-specific script when a parent and its
// variation both carry one.

/** Python reserved words, the output name, and the evaluator's builtin
 *  allow-list — never measurement inputs. */
const NON_INPUT_NAMES = new Set([
  "if", "elif", "else", "and", "or", "not", "in", "is", "True", "False",
  "None", "pass", "remark", "round", "min", "max", "abs", "len", "f",
  "garment", "cloth",
]);

/** The cloth fields captured during the measurement job (photo + color +
 *  dimensions) and exposed to scripts as cloth.<field>. */
export const CLOTH_FIELDS: { field: string; label: string; kind: "number" | "text" }[] = [
  { field: "length", label: "Cloth length (captured unit)", kind: "number" },
  { field: "breadth", label: "Cloth breadth (captured unit)", kind: "number" },
  { field: "color", label: "Cloth colour", kind: "text" },
  { field: "name", label: "Cloth name / fabric", kind: "text" },
];

/** Measurement variables a script reads, split by scope. */
export interface ScriptVars {
  /** Body measurement codes used bare (upper_bust). */
  body: string[];
  /** Per-garment reading codes used as garment.<code>. */
  garment: string[];
  /** Cloth capture fields used as cloth.<field>. */
  cloth: string[];
  /** Identifiers that look like inputs but match no known measurement. */
  unknown: string[];
}

function stripStrings(script: string): string {
  // Keep f-string interpolations ({expr} carries the variables we care
  // about), drop every other string literal's contents.
  return script.replace(
    /([fF]?)(['"])((?:[^\\]|\\.)*?)\2/g,
    (_m, flag: string, _q: string, body: string) => {
      if (!flag) return "";
      return (body.match(/\{([^{}]*)\}/g) ?? []).join(";").replace(/[{}]/g, "");
    },
  );
}

/** Find which measurement variables a script reads. Locals it assigns
 *  first (diff, cup, …) are its own business, not inputs. */
export function extractScriptVars(
  script: string,
  knownCodes: string[],
): ScriptVars {
  const code = stripStrings(script);
  const assigned = new Set<string>();
  for (const m of code.matchAll(/^[ \t]*([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)/gm)) {
    assigned.add(m[1]);
  }
  const known = new Set(knownCodes);
  const body = new Set<string>();
  const garment = new Set<string>();
  const cloth = new Set<string>();
  const unknown = new Set<string>();

  for (const m of code.matchAll(/\bgarment\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
    garment.add(m[1]);
  }
  for (const m of code.matchAll(/\bcloth\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
    cloth.add(m[1]);
  }
  // (?<!garment\.)(?<!cloth\.) keeps attribute names out of the
  // bare-identifier scan.
  for (const m of code.matchAll(
    /(?<!garment\.)(?<!cloth\.)\b([A-Za-z_][A-Za-z0-9_]*)\b/g,
  )) {
    const name = m[1];
    if (NON_INPUT_NAMES.has(name) || assigned.has(name)) continue;
    if (known.has(name)) body.add(name);
    else unknown.add(name);
  }
  return {
    body: [...body],
    garment: [...garment],
    cloth: [...cloth],
    unknown: [...unknown],
  };
}

/** Test-form strings → preview payload: numeric-looking values become
 *  numbers, blanks are dropped, anything else stays text. */
export function parseTestValues(
  form: Record<string, string>,
): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  for (const [key, raw] of Object.entries(form)) {
    const v = raw.trim();
    if (!v) continue;
    out[key] = /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
  }
  return out;
}

/** One saved reading paired with its metric, as the order page assembles
 *  them (fetchMeasurementMetrics + fetchJobReadings — metric.code is null
 *  for readings whose metric was deleted after capture). value_numeric is
 *  number | string because the generic tables endpoint serializes NUMERIC
 *  columns as strings. */
export interface ScriptReading {
  metric: { code: string | null };
  reading: {
    value_numeric: number | string | null;
    value_text: string | null;
  } | null;
}

/** Numeric-looking strings become numbers — the generic tables endpoint
 *  serializes NUMERIC columns as strings ("35", not 35), and scripts do
 *  arithmetic on measurements. Text like "C" stays a string. */
function coerceNumeric(v: number | string): number | string {
  if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim())) {
    return Number(v);
  }
  return v;
}

/** The cloth captured for this garment order during the measurement job
 *  (photo + colour + dimensions) — the type-cloth row's fields. */
export interface ClothValues {
  length?: number | string | null;
  breadth?: number | string | null;
  color?: string | null;
  name?: string | null;
}

/** Order readings → preview payload. Body readings map to their codes;
 *  per-garment readings map to garment.<code>; the captured cloth maps to
 *  cloth.<field>. Uncaptured metrics and unresolvable codes are omitted
 *  (the evaluator reports a missing name if the script needs one). */
export function buildScriptValues(
  body: ScriptReading[],
  garment: ScriptReading[] | null | undefined,
  cloth?: ClothValues | null,
): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  const put = (key: string, r: ScriptReading["reading"]) => {
    const v = r?.value_numeric ?? r?.value_text;
    if (v !== null && v !== undefined && v !== "") out[key] = coerceNumeric(v);
  };
  for (const r of body) {
    if (r.metric.code) put(r.metric.code, r.reading);
  }
  for (const r of garment ?? []) {
    if (r.metric.code) put(`garment.${r.metric.code}`, r.reading);
  }
  if (cloth) {
    for (const [field, v] of Object.entries(cloth)) {
      if (v !== null && v !== undefined && v !== "") {
        out[`cloth.${field}`] = typeof v === "number" ? v : coerceNumeric(v);
      }
    }
  }
  return out;
}

/** First non-empty script wins — call sites pass most-specific first
 *  (variation type before variation, add-on variation before add-on). */
export function pickRemarkScript(
  ...candidates: (string | null | undefined)[]
): string | null {
  for (const c of candidates) {
    const t = (c ?? "").trim();
    if (t) return t;
  }
  return null;
}
