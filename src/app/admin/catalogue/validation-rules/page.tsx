"use client";

import { useEffect, useState, useMemo, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { fetchTableRows } from "@/lib/admin-api";
import {
  Breadcrumb,
  ErrorState,
  LoadingState,
  Modal,
  SectionHeader,
} from "@/app/admin/catalogue/_shared/catalogue-helpers";

// ═══════════════════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════════════════

interface ValidationRuleRow {
  id: string;
  slug: string | null;
  code: string | null;
  garment_id: string | null;
  category: string | null;
  severity: string | null;
  kind: string | null;
  gate: Record<string, unknown> | null;
  condition: Record<string, unknown> | null;
  params: Record<string, unknown> | null;
  messages: Record<string, string> | null;
  is_active: boolean | null;
  is_protected: boolean | null;
  version: number | null;
  priority_order: number | null;
}

type ExprNode = Record<string, unknown>;

// ═══════════════════════════════════════════════════════════════════════════════
//  Visual condition tree renderer
//  Renders the expression tree as colored React nodes — metrics in blue,
//  params in purple, constants in gray, operators in bold red.
// ═══════════════════════════════════════════════════════════════════════════════

const OP_LABELS: Record<string, string> = {
  "<": "<",
  "<=": "≤",
  ">": ">",
  ">=": "≥",
  "==": "=",
  "!=": "≠",
};

/** Pretty-print a metric slug: bust_full_round → "bust full round" */
function prettyMetric(slug: string): string {
  return slug.replace(/_/g, " ");
}

/** Render a value node (leaf of the expression tree) as styled React */
function ValueNode({ node, params }: { node: ExprNode; params: Record<string, unknown> | null }): ReactNode {
  // {metric: "bust_full_round"}
  if (node.metric !== undefined) {
    return (
      <span className="inline-flex items-center rounded-md bg-blue-50 px-1.5 py-0.5 font-mono text-[12px] font-medium text-blue-700">
        {prettyMetric(String(node.metric))}
      </span>
    );
  }

  // {param: "min_gap"}
  if (node.param !== undefined) {
    const paramName = String(node.param);
    const paramVal = params?.[paramName];
    return (
      <span className="inline-flex items-center rounded-md bg-purple-50 px-1.5 py-0.5 font-mono text-[12px] font-medium text-purple-700" title={`Parameter: ${paramName}`}>
        {paramName}
        {paramVal !== undefined && (
          <span className="ml-1 text-purple-400">= {String(paramVal)}</span>
        )}
      </span>
    );
  }

  // {const: 7.5}
  if (node.const !== undefined) {
    return (
      <span className="inline-flex items-center rounded-md bg-gray-100 px-1.5 py-0.5 font-mono text-[12px] font-medium text-gray-600">
        {String(node.const)}
      </span>
    );
  }

  // {sum: [a, b]} → (a + b)
  if (node.sum !== undefined) {
    const parts = (node.sum as ExprNode[]).map((n, i) => (
      <span key={i}>
        {i > 0 && <span className="mx-1 font-mono text-[13px] font-bold text-ink-navy">+</span>}
        <ValueNode node={n} params={params} />
      </span>
    ));
    return <span className="inline-flex items-center gap-0.5 rounded-md border border-hairline bg-warm-sand/30 px-1.5 py-0.5">{parts}</span>;
  }

  // {diff: [a, b]} → (a − b)
  if (node.diff !== undefined) {
    const parts = (node.diff as ExprNode[]).map((n, i) => (
      <span key={i}>
        {i > 0 && <span className="mx-1 font-mono text-[13px] font-bold text-ink-navy">−</span>}
        <ValueNode node={n} params={params} />
      </span>
    ));
    return <span className="inline-flex items-center gap-0.5 rounded-md border border-hairline bg-warm-sand/30 px-1.5 py-0.5">{parts}</span>;
  }

  // {mul: [a, b]}
  if (node.mul !== undefined) {
    const parts = (node.mul as ExprNode[]).map((n, i) => (
      <span key={i}>
        {i > 0 && <span className="mx-1 font-mono text-[13px] font-bold text-ink-navy">×</span>}
        <ValueNode node={n} params={params} />
      </span>
    ));
    return <span className="inline-flex items-center gap-0.5 rounded-md border border-hairline bg-warm-sand/30 px-1.5 py-0.5">{parts}</span>;
  }

  // {div: [a, b]}
  if (node.div !== undefined) {
    const parts = (node.div as ExprNode[]).map((n, i) => (
      <span key={i}>
        {i > 0 && <span className="mx-1 font-mono text-[13px] font-bold text-ink-navy">÷</span>}
        <ValueNode node={n} params={params} />
      </span>
    ));
    return <span className="inline-flex items-center gap-0.5 rounded-md border border-hairline bg-warm-sand/30 px-1.5 py-0.5">{parts}</span>;
  }

  // {abs: node}
  if (node.abs !== undefined) {
    return (
      <span className="inline-flex items-center rounded-md border border-hairline bg-warm-sand/30 px-1.5 py-0.5">
        <span className="font-mono text-[13px] text-ink-navy">|</span>
        <ValueNode node={node.abs as ExprNode} params={params} />
        <span className="font-mono text-[13px] text-ink-navy">|</span>
      </span>
    );
  }

  return <code className="text-[12px] text-red-500">{JSON.stringify(node)}</code>;
}

/** Render a condition node (the actual check) as styled React */
function ConditionNode({ node, params }: { node: ExprNode; params: Record<string, unknown> | null }): ReactNode {
  // {cmp: {op, lhs, rhs}}
  if (node.cmp) {
    const c = node.cmp as { op: string; lhs: ExprNode; rhs: ExprNode };
    const opLabel = OP_LABELS[c.op] ?? c.op;
    return (
      <div className="flex flex-wrap items-center gap-2">
        <ValueNode node={c.lhs} params={params} />
        <span className="rounded-md bg-red-50 px-2 py-0.5 font-mono text-[13px] font-bold text-red-600">{opLabel}</span>
        <ValueNode node={c.rhs} params={params} />
      </div>
    );
  }

  // {outside: {value, min, max}}
  if (node.outside) {
    const o = node.outside as { value: ExprNode; min: ExprNode; max: ExprNode };
    return (
      <div className="flex flex-wrap items-center gap-2">
        <ValueNode node={o.value} params={params} />
        <span className="rounded-md bg-amber-50 px-2 py-0.5 font-mono text-[11px] font-bold text-amber-700">outside</span>
        <div className="flex items-center gap-1 rounded-md border border-hairline bg-warm-sand/30 px-1.5 py-0.5">
          <ValueNode node={o.min} params={params} />
          <span className="text-[11px] text-muted">…</span>
          <ValueNode node={o.max} params={params} />
        </div>
      </div>
    );
  }

  // {in: {value, options}}
  if (node.in && typeof node.in === "object" && !Array.isArray(node.in)) {
    const i = node.in as { value: ExprNode; options: string[] };
    return (
      <div className="flex flex-wrap items-center gap-2">
        <ValueNode node={i.value} params={params} />
        <span className="rounded-md bg-emerald-50 px-2 py-0.5 font-mono text-[11px] font-bold text-emerald-700">in</span>
        <div className="flex flex-wrap items-center gap-1">
          {i.options.map((opt, idx) => (
            <span key={idx} className="rounded-md border border-hairline bg-warm-sand/30 px-1.5 py-0.5 font-mono text-[11px] text-ink-navy">
              {opt}
            </span>
          ))}
        </div>
      </div>
    );
  }

  // {all: [...]}
  if (node.all) {
    const children = node.all as ExprNode[];
    return (
      <div className="space-y-1.5">
        <div className="inline-block rounded-md bg-indigo-50 px-2 py-0.5 font-mono text-[11px] font-bold uppercase text-indigo-700">ALL of</div>
        <div className="space-y-1.5 border-l-2 border-indigo-200 pl-3">
          {children.map((child, idx) => (
            <div key={idx}>
              <ConditionNode node={child} params={params} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // {any: [...]}
  if (node.any) {
    const children = node.any as ExprNode[];
    return (
      <div className="space-y-1.5">
        <div className="inline-block rounded-md bg-teal-50 px-2 py-0.5 font-mono text-[11px] font-bold uppercase text-teal-700">ANY of (OR)</div>
        <div className="space-y-1.5 border-l-2 border-teal-200 pl-3">
          {children.map((child, idx) => (
            <div key={idx}>
              <ConditionNode node={child} params={params} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // {not: {...}}
  if (node.not) {
    return (
      <div className="space-y-1.5">
        <div className="inline-block rounded-md bg-rose-50 px-2 py-0.5 font-mono text-[11px] font-bold uppercase text-rose-700">NOT</div>
        <div className="border-l-2 border-rose-200 pl-3">
          <ConditionNode node={node.not as ExprNode} params={params} />
        </div>
      </div>
    );
  }

  return <code className="block text-[12px] text-red-500">{JSON.stringify(node, null, 2)}</code>;
}

/** Render a gate node (style filter) */
function GateNode({ gate }: { gate: Record<string, unknown> }): ReactNode {
  function walk(g: Record<string, unknown>): ReactNode {
    if (g.in && typeof g.in === "object" && !Array.isArray(g.in)) {
      const i = g.in as { style: string; options: string[] };
      return (
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-blue-50 px-1.5 py-0.5 font-mono text-[12px] font-medium text-blue-700">{i.style}</span>
          <span className="rounded-md bg-emerald-50 px-2 py-0.5 font-mono text-[11px] font-bold text-emerald-700">in</span>
          <div className="flex flex-wrap items-center gap-1">
            {i.options.map((opt, idx) => (
              <span key={idx} className="rounded-md border border-hairline bg-warm-sand/30 px-1.5 py-0.5 font-mono text-[11px] text-ink-navy">
                {opt}
              </span>
            ))}
          </div>
        </div>
      );
    }
    if (g.not) {
      return (
        <div className="space-y-1.5">
          <div className="inline-block rounded-md bg-rose-50 px-2 py-0.5 font-mono text-[11px] font-bold uppercase text-rose-700">NOT</div>
          <div className="border-l-2 border-rose-200 pl-3">
            {walk(g.not as Record<string, unknown>)}
          </div>
        </div>
      );
    }
    if (g.all) {
      const children = g.all as Record<string, unknown>[];
      return (
        <div className="space-y-1.5">
          <div className="inline-block rounded-md bg-indigo-50 px-2 py-0.5 font-mono text-[11px] font-bold uppercase text-indigo-700">ALL of</div>
          <div className="space-y-1.5 border-l-2 border-indigo-200 pl-3">
            {children.map((child, idx) => (<div key={idx}>{walk(child)}</div>))}
          </div>
        </div>
      );
    }
    if (g.any) {
      const children = g.any as Record<string, unknown>[];
      return (
        <div className="space-y-1.5">
          <div className="inline-block rounded-md bg-teal-50 px-2 py-0.5 font-mono text-[11px] font-bold uppercase text-teal-700">ANY of</div>
          <div className="space-y-1.5 border-l-2 border-teal-200 pl-3">
            {children.map((child, idx) => (<div key={idx}>{walk(child)}</div>))}
          </div>
        </div>
      );
    }
    return <code className="text-[12px] text-red-500">{JSON.stringify(g)}</code>;
  }

  return walk(gate);
}

// Plain text versions for the card preview
function valueNodeToText(node: ExprNode, params: Record<string, unknown> | null): string {
  if (node.metric) return prettyMetric(String(node.metric));
  if (node.param) {
    const val = params?.[String(node.param)];
    return val != null ? `${String(node.param)}=${String(val)}` : String(node.param);
  }
  if (node.const !== undefined) return String(node.const);
  if (node.sum) return `(${(node.sum as ExprNode[]).map((n) => valueNodeToText(n, params)).join(" + ")})`;
  if (node.diff) return `(${(node.diff as ExprNode[]).map((n) => valueNodeToText(n, params)).join(" − ")})`;
  if (node.mul) return `(${(node.mul as ExprNode[]).map((n) => valueNodeToText(n, params)).join(" × ")})`;
  if (node.div) return `(${(node.div as ExprNode[]).map((n) => valueNodeToText(n, params)).join(" ÷ ")})`;
  if (node.abs) return `|${valueNodeToText(node.abs as ExprNode, params)}|`;
  return JSON.stringify(node);
}

function conditionToText(node: ExprNode | null, params: Record<string, unknown> | null): string {
  if (!node) return "—";
  if (node.cmp) {
    const c = node.cmp as { op: string; lhs: ExprNode; rhs: ExprNode };
    return `${valueNodeToText(c.lhs, params)} ${OP_LABELS[c.op] ?? c.op} ${valueNodeToText(c.rhs, params)}`;
  }
  if (node.outside) {
    const o = node.outside as { value: ExprNode; min: ExprNode; max: ExprNode };
    return `${valueNodeToText(o.value, params)} outside [${valueNodeToText(o.min, params)}, ${valueNodeToText(o.max, params)}]`;
  }
  if (node.in && typeof node.in === "object" && !Array.isArray(node.in)) {
    const i = node.in as { value: ExprNode; options: string[] };
    return `${valueNodeToText(i.value, params)} ∈ {${i.options.join(", ")}}`;
  }
  if (node.all) {
    const parts = (node.all as ExprNode[]).map((c) => conditionToText(c, params));
    return parts.join(" AND ");
  }
  if (node.any) {
    const parts = (node.any as ExprNode[]).map((c) => conditionToText(c, params));
    return parts.length > 1 ? `(${parts.join(" OR ")})` : parts[0] ?? "—";
  }
  if (node.not) return `NOT (${conditionToText(node.not as ExprNode, params)})`;
  return JSON.stringify(node);
}

function gateToText(gate: Record<string, unknown> | null): string | null {
  if (!gate) return null;
  function walk(g: Record<string, unknown>): string {
    if (g.in && typeof g.in === "object" && !Array.isArray(g.in)) {
      const i = g.in as { style: string; options: string[] };
      return `${i.style} ∈ {${i.options.join(", ")}}`;
    }
    if (g.not) return `NOT (${walk(g.not as Record<string, unknown>)})`;
    if (g.all) return (g.all as Record<string, unknown>[]).map(walk).join(" AND ");
    if (g.any) return `(${(g.any as Record<string, unknown>[]).map(walk).join(" OR ")})`;
    return JSON.stringify(g);
  }
  return walk(gate);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Category + severity helpers
// ═══════════════════════════════════════════════════════════════════════════════

const CATEGORY_LABELS: Record<string, string> = {
  bust: "Bust Hierarchy",
  shoulder: "Shoulder Block",
  apex: "Apex Geometry",
  neck: "Neck Depths",
  lengths: "Lengths",
  sleeves: "Arms & Sleeves",
  bands: "Plausibility Bands",
  hygiene: "Data Hygiene",
};

const CATEGORY_ORDER = ["bust", "shoulder", "apex", "neck", "lengths", "sleeves", "bands", "hygiene"];

function SeverityBadge({ severity }: { severity: string | null }) {
  const isCritical = severity === "critical";
  return (
    <span className={`inline-flex items-center rounded-pill px-2 py-0.5 text-[10px] font-medium ${isCritical ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
      {isCritical ? "Critical" : "Non-critical"}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Rule card (grid view)
// ═══════════════════════════════════════════════════════════════════════════════

function RuleCard({ rule, onClick }: { rule: ValidationRuleRow; onClick: () => void }) {
  const condText = rule.kind === "builtin" ? "Built-in check" : conditionToText(rule.condition, rule.params);
  const gateText = gateToText(rule.gate);
  const msg = rule.messages?.en ?? "—";

  return (
    <button
      onClick={onClick}
      className="group block w-full rounded-card border border-hairline bg-chalk-white p-4 text-left shadow-card transition hover:border-hairline-strong hover:shadow-lg"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex min-w-[32px] items-center justify-center rounded-pill bg-ink-navy px-2 py-0.5 font-mono text-[11px] font-bold text-chalk-white">
            {rule.code ?? "?"}
          </span>
          <SeverityBadge severity={rule.severity} />
          {rule.is_protected && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-muted">
              <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none">
                <path d="M5 7V5a3 3 0 0 1 6 0v2M4 7h8v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7z" stroke="currentColor" strokeWidth="1.2" />
              </svg>
              Protected
            </span>
          )}
          {rule.kind === "builtin" && (
            <span className="inline-flex items-center rounded-pill bg-purple-100 px-2 py-0.5 text-[10px] font-medium text-purple-700">Built-in</span>
          )}
        </div>
        <span className="font-mono text-[10px] text-muted">{rule.slug}</span>
      </div>

      <div className="mt-3 rounded-lg bg-mist-navy/50 px-3 py-2">
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted">Condition</div>
        <code className="mt-0.5 block text-[12px] leading-relaxed text-ink-navy">{condText}</code>
      </div>

      {gateText && (
        <div className="mt-2 flex items-center gap-1.5">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted">Gate:</span>
          <code className="text-[11px] text-ink/70">{gateText}</code>
        </div>
      )}

      <p className="mt-2 line-clamp-2 text-[12px] leading-snug text-muted">{msg}</p>
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Rule detail modal — rich visual condition tree
// ═══════════════════════════════════════════════════════════════════════════════

function RuleDetailModal({ rule, onClose }: { rule: ValidationRuleRow | null; onClose: () => void }) {
  if (!rule) return null;

  const gateText = gateToText(rule.gate);

  return (
    <Modal open={!!rule} title={`Rule ${rule.code} — ${rule.slug}`} onClose={onClose} maxWidth="max-w-2xl">
      <div className="space-y-5">
        {/* ── Meta badges ── */}
        <div className="flex flex-wrap items-center gap-2">
          <SeverityBadge severity={rule.severity} />
          <span className="rounded-pill bg-mist-navy px-2 py-0.5 text-[11px] text-ink-navy">
            {CATEGORY_LABELS[rule.category ?? ""] ?? rule.category}
          </span>
          {rule.is_protected && (
            <span className="inline-flex items-center gap-1 rounded-pill bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700">
              <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none">
                <path d="M5 7V5a3 3 0 0 1 6 0v2M4 7h8v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7z" stroke="currentColor" strokeWidth="1.2" />
              </svg>
              Protected (physics rule)
            </span>
          )}
          <span className="rounded-pill bg-mist-navy px-2 py-0.5 text-[11px] text-ink-navy">v{rule.version ?? 1}</span>
          <span className="rounded-pill bg-mist-navy px-2 py-0.5 text-[11px] text-ink-navy">priority: {rule.priority_order ?? "—"}</span>
          {rule.kind === "builtin" && (
            <span className="rounded-pill bg-purple-100 px-2 py-0.5 text-[11px] text-purple-700">Built-in</span>
          )}
        </div>

        {/* ── Condition: Visual Tree ── */}
        <div>
          <div className="mb-2 flex items-center gap-2">
            <div className="text-[12px] font-semibold uppercase tracking-wide text-ink-navy">Condition</div>
            <div className="h-px flex-1 bg-hairline" />
          </div>

          {rule.kind === "builtin" ? (
            <div className="rounded-lg border border-purple-200 bg-purple-50 px-4 py-3">
              <p className="text-[13px] text-purple-800">
                <span className="font-medium">Built-in check</span> — implemented in Python, not as an expression tree.
              </p>
            </div>
          ) : rule.condition ? (
            <div className="rounded-lg border border-hairline bg-chalk-white px-4 py-3">
              <ConditionNode node={rule.condition} params={rule.params} />
            </div>
          ) : (
            <p className="text-[13px] text-muted italic">No condition defined.</p>
          )}

          {/* Legend */}
          <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-muted">
            <span className="flex items-center gap-1">
              <span className="h-3 w-3 rounded bg-blue-100" /> metric
            </span>
            <span className="flex items-center gap-1">
              <span className="h-3 w-3 rounded bg-purple-100" /> parameter
            </span>
            <span className="flex items-center gap-1">
              <span className="h-3 w-3 rounded bg-gray-200" /> constant
            </span>
            <span className="flex items-center gap-1">
              <span className="h-3 w-3 rounded bg-red-100" /> operator
            </span>
          </div>
        </div>

        {/* ── Raw condition JSON (collapsible) ── */}
        {rule.condition && (
          <details className="group">
            <summary className="cursor-pointer text-[11px] font-medium text-muted hover:text-ink-navy">
              ▸ Raw condition JSON
            </summary>
            <pre className="mt-2 overflow-x-auto rounded-lg bg-ink-navy p-3 text-[11px] leading-relaxed text-chalk-white/90">
              {JSON.stringify(rule.condition, null, 2)}
            </pre>
          </details>
        )}

        {/* ── Gate ── */}
        <div>
          <div className="mb-2 flex items-center gap-2">
            <div className="text-[12px] font-semibold uppercase tracking-wide text-ink-navy">Gate (style filter)</div>
            <div className="h-px flex-1 bg-hairline" />
          </div>
          {rule.gate ? (
            <div className="rounded-lg border border-hairline bg-chalk-white px-4 py-3">
              <GateNode gate={rule.gate} />
            </div>
          ) : (
            <p className="text-[12px] text-muted italic">Always applies — no style gate.</p>
          )}
        </div>

        {/* ── Params ── */}
        {rule.params && Object.keys(rule.params).length > 0 && (
          <div>
            <div className="mb-2 flex items-center gap-2">
              <div className="text-[12px] font-semibold uppercase tracking-wide text-ink-navy">Parameters</div>
              <div className="h-px flex-1 bg-hairline" />
            </div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(rule.params).map(([key, val]) => (
                <code key={key} className="rounded-lg border border-hairline bg-chalk-white px-2.5 py-1 text-[12px] text-ink-navy">
                  <span className="text-purple-600">{key}</span>
                  <span className="text-muted"> = </span>
                  <span className="font-medium">{JSON.stringify(val)}</span>
                </code>
              ))}
            </div>
          </div>
        )}

        {/* ── Messages ── */}
        <div>
          <div className="mb-2 flex items-center gap-2">
            <div className="text-[12px] font-semibold uppercase tracking-wide text-ink-navy">Messages</div>
            <div className="h-px flex-1 bg-hairline" />
          </div>
          <div className="space-y-2">
            {Object.entries(rule.messages ?? {}).map(([lang, text]) => (
              <div key={lang} className="rounded-lg border border-hairline bg-chalk-white px-3 py-2">
                <span className="mr-2 inline-block min-w-[28px] rounded-pill bg-mist-navy px-1.5 py-0.5 text-center text-[10px] font-medium uppercase text-ink-navy">
                  {lang}
                </span>
                <span className="text-[13px] text-ink">{text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Main page
// ═══════════════════════════════════════════════════════════════════════════════

export default function ValidationRulesPage() {
  const router = useRouter();
  const [rules, setRules] = useState<ValidationRuleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedRule, setSelectedRule] = useState<ValidationRuleRow | null>(null);
  const [filterCategory, setFilterCategory] = useState<string | null>(null);
  const [filterSeverity, setFilterSeverity] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Fetch rules
  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const { rows } = await fetchTableRows<ValidationRuleRow>("validation_rules", {
          filters: { is_active: true },
          perPage: 100,
          sortColumn: "priority_order",
          sortDirection: "asc",
        });

        // Defensive: parse condition/gate/params/messages if they come back as strings
        const parsed = rows.map((r) => ({
          ...r,
          condition: typeof r.condition === "string" ? JSON.parse(r.condition) : r.condition,
          gate: typeof r.gate === "string" ? JSON.parse(r.gate) : r.gate,
          params: typeof r.params === "string" ? JSON.parse(r.params) : r.params,
          messages: typeof r.messages === "string" ? JSON.parse(r.messages) : r.messages,
        }));

        console.log("[validation-rules] loaded", parsed.length, "rules, first:", parsed[0]);
        setRules(parsed);
      } catch (err) {
        console.error("[validation-rules] fetch error:", err);
        setError(err instanceof Error ? err.message : "Failed to load validation rules");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Emit secondary sidebar items
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("admin-sidebar-update", {
        detail: {
          items: [
            { label: "Slot Scheduling", active: false, onClick: () => router.push("/admin/actions/slot-scheduling") },
            { label: "URLs", active: false, onClick: () => router.push("/admin/actions/urls") },
            { label: "Measurements", active: false, onClick: () => router.push("/admin/measurements") },
            { label: "Validation Rules", active: true, onClick: () => router.push("/admin/catalogue/validation-rules") },
            { label: "SOP Video Generator", active: false, onClick: () => router.push("/admin/actions/sop-video") },
          ],
        },
      }),
    );
    return () => {
      window.dispatchEvent(new CustomEvent("admin-sidebar-update", { detail: null }));
    };
  }, [router]);

  const filteredRules = useMemo(() => {
    return rules.filter((r) => {
      if (filterCategory && r.category !== filterCategory) return false;
      if (filterSeverity && r.severity !== filterSeverity) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const haystack = `${r.code ?? ""} ${r.slug ?? ""} ${r.messages?.en ?? ""} ${r.category ?? ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [rules, filterCategory, filterSeverity, searchQuery]);

  const grouped = useMemo(() => {
    const map = new Map<string, ValidationRuleRow[]>();
    for (const r of filteredRules) {
      const cat = r.category ?? "other";
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(r);
    }
    return map;
  }, [filteredRules]);

  const stats = useMemo(() => {
    const critical = rules.filter((r) => r.severity === "critical").length;
    const nonCritical = rules.filter((r) => r.severity === "non_critical").length;
    const protectedCount = rules.filter((r) => r.is_protected).length;
    return { total: rules.length, critical, nonCritical, protected: protectedCount };
  }, [rules]);

  return (
    <div className="min-h-dvh bg-warm-sand p-4 md:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl">
        <Breadcrumb
          crumbs={[
            { label: "Configure", onClick: () => router.push("/admin/actions/slot-scheduling") },
            { label: "Validation Rules" },
          ]}
        />

        <div className="mt-3 mb-5">
          <h1 className="font-heading text-xl font-bold text-ink-navy">Validation Rules</h1>
          <p className="mt-1 text-[13px] text-muted">Measurement validation engine — catalog v1.2</p>
        </div>

        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Total Rules" value={stats.total} />
          <StatCard label="Critical" value={stats.critical} color="text-red-600" />
          <StatCard label="Non-critical" value={stats.nonCritical} color="text-amber-600" />
          <StatCard label="Protected" value={stats.protected} color="text-blue-600" />
        </div>

        <div className="mb-5 flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by code, slug, message…"
            className="min-w-[200px] flex-1 rounded-card border border-hairline-strong bg-chalk-white px-3 py-2 text-[13px] text-ink outline-none transition focus:border-ink-navy"
          />
          <select
            value={filterCategory ?? ""}
            onChange={(e) => setFilterCategory(e.target.value || null)}
            className="rounded-card border border-hairline-strong bg-chalk-white px-3 py-2 text-[13px] text-ink outline-none"
          >
            <option value="">All categories</option>
            {CATEGORY_ORDER.map((cat) => (
              <option key={cat} value={cat}>{CATEGORY_LABELS[cat] ?? cat}</option>
            ))}
          </select>
          <select
            value={filterSeverity ?? ""}
            onChange={(e) => setFilterSeverity(e.target.value || null)}
            className="rounded-card border border-hairline-strong bg-chalk-white px-3 py-2 text-[13px] text-ink outline-none"
          >
            <option value="">All severities</option>
            <option value="critical">Critical</option>
            <option value="non_critical">Non-critical</option>
          </select>
        </div>

        {loading ? (
          <LoadingState message="Loading validation rules…" />
        ) : error ? (
          <ErrorState message={error} />
        ) : filteredRules.length === 0 ? (
          <div className="flex h-40 items-center justify-center rounded-card border border-dashed border-hairline-strong text-[13px] text-muted">
            No rules match the current filters.
          </div>
        ) : (
          <div className="space-y-6">
            {CATEGORY_ORDER.map((cat) => {
              const catRules = grouped.get(cat);
              if (!catRules || catRules.length === 0) return null;
              return (
                <div key={cat}>
                  <SectionHeader title={CATEGORY_LABELS[cat] ?? cat} count={catRules.length} />
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {catRules.map((rule) => (
                      <RuleCard key={rule.id} rule={rule} onClick={() => setSelectedRule(rule)} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <RuleDetailModal rule={selectedRule} onClose={() => setSelectedRule(null)} />
    </div>
  );
}

function StatCard({ label, value, color = "text-ink-navy" }: { label: string; value: number; color?: string }) {
  return (
    <div className="rounded-card border border-hairline bg-chalk-white p-3 shadow-card">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 font-heading text-2xl font-bold ${color}`}>{value}</div>
    </div>
  );
}
