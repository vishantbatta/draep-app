// ═══════════════════════════════════════════════════════════════════════════════
//  Validation Engine — TypeScript types for the JSON expression-tree grammar
//
//  This mirrors the backend evaluator/validator grammar exactly.
//  See: be/app/services/validation/evaluator.py + validator.py
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Value nodes (produce a float) ──────────────────────────────────────────

export type ValueNode =
  | { metric: string }
  | { param: string }
  | { const: number }
  | { sum: ValueNode[] }
  | { diff: [ValueNode, ValueNode] }
  | { mul: [ValueNode, ValueNode] }
  | { div: [ValueNode, ValueNode] }
  | { abs: ValueNode };

// ─── Condition nodes (produce true/false) ───────────────────────────────────

export type CmpOp = "<" | "<=" | ">" | ">=" | "==" | "!=";

export type ConditionNode =
  | { cmp: { op: CmpOp; lhs: ValueNode; rhs: ValueNode } }
  | { outside: { value: ValueNode; min: ValueNode; max: ValueNode } }
  | { all: ConditionNode[] }
  | { any: ConditionNode[] }
  | { not: ConditionNode }
  | { in: { style: string; options: string[] } };

// ─── Gate (style filter) — same condition-node grammar but typically `in`/`not`/`all` ─

export type GateNode = ConditionNode;

// ─── Validation Rule (full DB row) ──────────────────────────────────────────

export interface ValidationRule {
  id: string;
  slug: string;
  code: string;
  garment_id: string | null;
  category: string;
  severity: "critical" | "non_critical";
  kind: "expression" | "builtin";
  gate: GateNode | null;
  condition: ConditionNode | null;
  params: Record<string, number> | null;
  messages: Record<string, string>;
  is_active: boolean;
  is_protected: boolean;
  version: number;
  priority_order: number | null;
  created_at?: string | null;
}

// ─── Payload for creating a new rule ────────────────────────────────────────

export interface RuleCreatePayload {
  slug: string;
  code: string;
  garment_id: string;
  category: string;
  severity: string;
  kind: string;
  gate: GateNode | null;
  condition: ConditionNode | null;
  params: Record<string, number> | null;
  messages: Record<string, string>;
  is_protected: boolean;
  priority_order: number;
}

// ─── Payload for editing a rule ─────────────────────────────────────────────

export interface RuleUpdatePayload {
  code?: string;
  garment_id?: string;
  category?: string;
  severity?: string;
  kind?: string;
  gate?: GateNode | null;
  condition?: ConditionNode | null;
  params?: Record<string, number> | null;
  messages?: Record<string, string>;
  is_protected?: boolean;
  priority_order?: number;
  confirm?: boolean;
}

// ─── Constants ──────────────────────────────────────────────────────────────

export const CATEGORY_OPTIONS = [
  { value: "bust", label: "Bust Hierarchy" },
  { value: "shoulder", label: "Shoulder Block" },
  { value: "apex", label: "Apex Geometry" },
  { value: "neck", label: "Neck Depths" },
  { value: "lengths", label: "Lengths" },
  { value: "sleeves", label: "Arms & Sleeves" },
  { value: "bands", label: "Plausibility Bands" },
  { value: "hygiene", label: "Data Hygiene" },
];

export const SEVERITY_OPTIONS = [
  { value: "critical", label: "Critical" },
  { value: "non_critical", label: "Non-critical" },
];

export const CMP_OPS: { value: CmpOp; label: string }[] = [
  { value: "<", label: "< (less than)" },
  { value: "<=", label: "≤ (less or equal)" },
  { value: ">", label: "> (greater than)" },
  { value: ">=", label: "≥ (greater or equal)" },
  { value: "==", label: "= (equal)" },
  { value: "!=", label: "≠ (not equal)" },
];

export const STYLE_FIELDS = [
  { value: "sleeve", label: "Sleeve" },
  { value: "back_cut", label: "Back Cut" },
  { value: "tying", label: "Tying" },
  { value: "front_neck", label: "Front Neck" },
];

// ─── Helper: value-node label for display ───────────────────────────────────

export function valueNodeLabel(node: ValueNode, params: Record<string, number> | null): string {
  if ("metric" in node) return node.metric.replace(/_/g, " ");
  if ("param" in node) {
    const v = params?.[node.param];
    return v != null ? `${node.param} (= ${v})` : node.param;
  }
  if ("const" in node) return String(node.const);
  if ("sum" in node) return `(${node.sum.map((n) => valueNodeLabel(n, params)).join(" + ")})`;
  if ("diff" in node) return `(${valueNodeLabel(node.diff[0], params)} − ${valueNodeLabel(node.diff[1], params)})`;
  if ("mul" in node) return `(${valueNodeLabel(node.mul[0], params)} × ${valueNodeLabel(node.mul[1], params)})`;
  if ("div" in node) return `(${valueNodeLabel(node.div[0], params)} ÷ ${valueNodeLabel(node.div[1], params)})`;
  if ("abs" in node) return `|${valueNodeLabel(node.abs, params)}|`;
  return "?";
}

export function conditionNodeLabel(
  node: ConditionNode,
  params: Record<string, number> | null,
): string {
  if ("cmp" in node) {
    const c = node.cmp;
    return `${valueNodeLabel(c.lhs, params)} ${c.op} ${valueNodeLabel(c.rhs, params)}`;
  }
  if ("outside" in node) {
    const o = node.outside;
    return `${valueNodeLabel(o.value, params)} outside [${valueNodeLabel(o.min, params)}, ${valueNodeLabel(o.max, params)}]`;
  }
  if ("all" in node) return node.all.map((c) => conditionNodeLabel(c, params)).join(" AND ");
  if ("any" in node) return `(${node.any.map((c) => conditionNodeLabel(c, params)).join(" OR ")})`;
  if ("not" in node) return `NOT (${conditionNodeLabel(node.not, params)})`;
  if ("in" in node) return `${node.in.style} ∈ {${node.in.options.join(", ")}}`;
  return "?";
}

export function gateLabel(gate: GateNode | null): string | null {
  if (!gate) return null;
  return conditionNodeLabel(gate, null);
}

// ─── Factory helpers for creating nodes ─────────────────────────────────────

export function metricNode(code: string): ValueNode {
  return { metric: code };
}
export function paramNode(key: string): ValueNode {
  return { param: key };
}
export function constNode(n: number): ValueNode {
  return { const: n };
}
export function cmpCondition(op: CmpOp, lhs: ValueNode, rhs: ValueNode): ConditionNode {
  return { cmp: { op, lhs, rhs } };
}
