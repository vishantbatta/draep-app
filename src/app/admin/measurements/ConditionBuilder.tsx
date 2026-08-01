"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Modal } from "@/app/admin/catalogue/_shared/catalogue-helpers";
import { getAdminToken, getLabel } from "@/lib/admin-api";
import {
  type ConditionNode,
  type CmpOp,
  type GateNode,
  type ValidationRule,
  type ValueNode,
  type RuleCreatePayload,
  type RuleUpdatePayload,
  CATEGORY_OPTIONS,
  CMP_OPS,
  SEVERITY_OPTIONS,
  STYLE_FIELDS,
  conditionNodeLabel,
  gateLabel,
} from "@/lib/validation-types";

// ═══════════════════════════════════════════════════════════════════════════════
//  Metric codes (fetched from backend)
// ═══════════════════════════════════════════════════════════════════════════════

interface MetricInfo {
  id: string;
  code: string | null;
  labels: Record<string, string> | null;
  slug: string | null;
}

interface GarmentInfo {
  id: string;
  slug: string | null;
  labels: Record<string, string> | null;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "/api/v1";

// ═══════════════════════════════════════════════════════════════════════════════
//  Main modal — exported
// ═══════════════════════════════════════════════════════════════════════════════

export function ConditionBuilderModal({ onClose }: { onClose: () => void }) {
  const [rules, setRules] = useState<ValidationRule[]>([]);
  const [metrics, setMetrics] = useState<MetricInfo[]>([]);
  const [garments, setGarments] = useState<GarmentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState<string | null>(null);
  const [editingRule, setEditingRule] = useState<ValidationRule | null>(null);
  const [creatingNew, setCreatingNew] = useState(false);

  // ─── Load rules + metrics + garments ───────────────────────────────────────
  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = getAdminToken();
      const headers: Record<string, string> = { Authorization: `Bearer ${token}` };

      const [rulesRes, metricsRes, garmentsRes] = await Promise.all([
        fetch(`${API_URL}/admin/validation-rules?active=true`, { headers }),
        fetch(`${API_URL}/admin/tables/measurement_metrics?per_page=100`, { headers }),
        fetch(`${API_URL}/admin/tables/garments?per_page=100`, { headers }),
      ]);

      if (!rulesRes.ok) throw new Error(`Failed to load rules (${rulesRes.status})`);
      const rulesData: ValidationRule[] = await rulesRes.json();

      let metricsData: MetricInfo[] = [];
      if (metricsRes.ok) {
        const body = await metricsRes.json();
        metricsData = (body.rows ?? body ?? []) as MetricInfo[];
      }

      let garmentsData: GarmentInfo[] = [];
      if (garmentsRes.ok) {
        const body = await garmentsRes.json();
        garmentsData = (body.rows ?? body ?? []) as GarmentInfo[];
      }

      setRules(rulesData);
      setMetrics(metricsData.filter((m) => m.code));
      setGarments(garmentsData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // ─── Filtered rules ────────────────────────────────────────────────────────
  const filteredRules = useMemo(() => {
    let result = rules;
    if (filterCategory) result = result.filter((r) => r.category === filterCategory);
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((r) =>
        `${r.code} ${r.slug} ${r.messages?.en ?? ""} ${r.category}`
          .toLowerCase()
          .includes(q),
      );
    }
    return result;
  }, [rules, filterCategory, search]);

  const grouped = useMemo(() => {
    const map = new Map<string, ValidationRule[]>();
    for (const r of filteredRules) {
      const cat = r.category ?? "other";
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(r);
    }
    return map;
  }, [filteredRules]);

  // ─── Handle saved (from editor) ────────────────────────────────────────────
  function handleSaved() {
    setEditingRule(null);
    setCreatingNew(false);
    void reload();
  }

  // ─── Handle delete ─────────────────────────────────────────────────────────
  async function handleDelete(rule: ValidationRule) {
    if (rule.is_protected && !confirm(`"${rule.slug}" is a protected physics rule. Deactivate it?`)) return;
    if (!rule.is_protected && !confirm(`Deactivate rule "${rule.slug}"?`)) return;

    try {
      const token = getAdminToken();
      const url = `${API_URL}/admin/validation-rules/${rule.slug}${rule.is_protected ? "?confirm=true" : ""}`;
      const res = await fetch(url, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error?.message ?? `Failed (${res.status})`);
      }
      void reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to delete");
    }
  }

  // ══════ Render ════════════════════════════════════════════════════════════════

  // ─── Editor mode ───────────────────────────────────────────────────────────
  if (editingRule || creatingNew) {
    return (
      <RuleEditor
        rule={editingRule}
        metrics={metrics}
        garments={garments}
        isNew={creatingNew}
        onClose={() => {
          setEditingRule(null);
          setCreatingNew(false);
        }}
        onSaved={handleSaved}
      />
    );
  }

  // ─── List mode ─────────────────────────────────────────────────────────────
  return (
    <Modal open={true} title="Manage Conditions" onClose={onClose} maxWidth="max-w-5xl">
      <div className="space-y-4">
        {/* Description */}
        <p className="text-[12px] leading-relaxed text-muted">
          Create, edit, and manage measurement validation rules. Each rule checks one or more
          body measurements against a condition and fires a message when the check fails.
        </p>

        {/* Toolbar */}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setCreatingNew(true)}
              className="tap inline-flex items-center gap-1.5 rounded-pill bg-ink-navy px-3.5 py-1.5 text-[12px] font-medium text-chalk-white transition hover:bg-ink-navy/90 active:scale-95"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none">
                <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
              New Rule
            </button>

            <select
              value={filterCategory ?? ""}
              onChange={(e) => setFilterCategory(e.target.value || null)}
              className="rounded-pill border border-hairline-strong bg-chalk-white px-3 py-1.5 text-[12px] font-medium text-ink-navy outline-none"
            >
              <option value="">All Categories</option>
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>

            <span className="text-[11px] font-medium text-muted">
              {filteredRules.length} of {rules.length} rules
            </span>
          </div>

          <div className="relative">
            <svg className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" viewBox="0 0 16 16" fill="none">
              <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.3" />
              <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search rules..."
              className="w-full rounded-pill border border-hairline-strong bg-chalk-white py-2 pl-9 pr-4 text-[13px] outline-none transition focus:border-ink-navy lg:w-64"
            />
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex h-40 items-center justify-center text-[13px] text-muted">Loading rules...</div>
        ) : error ? (
          <div className="rounded-card border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-600">{error}</div>
        ) : filteredRules.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center gap-3 rounded-card border border-dashed border-hairline-strong">
            <span className="text-[13px] text-muted">No rules found.</span>
            <button
              onClick={() => setCreatingNew(true)}
              className="tap inline-flex items-center gap-1.5 rounded-pill bg-ink-navy px-3.5 py-1.5 text-[12px] font-medium text-chalk-white"
            >
              Create your first rule
            </button>
          </div>
        ) : (
          <div className="max-h-[55vh] space-y-4 overflow-y-auto pr-1">
            {CATEGORY_OPTIONS.map((catOpt) => {
              const catRules = grouped.get(catOpt.value);
              if (!catRules || catRules.length === 0) return null;
              return (
                <div key={catOpt.value}>
                  <div className="mb-2 flex items-center gap-2">
                    <h3 className="text-[12px] font-bold uppercase tracking-wide text-ink-navy">{catOpt.label}</h3>
                    <span className="inline-flex min-w-[20px] items-center justify-center rounded-pill bg-mist-navy px-1.5 py-0.5 font-mono text-[10px] font-medium text-ink-navy">
                      {catRules.length}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-2">
                    {catRules.map((rule) => (
                      <RuleListCard
                        key={rule.id}
                        rule={rule}
                        onEdit={() => setEditingRule(rule)}
                        onDelete={() => handleDelete(rule)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Rule list card — compact row in the list
// ═══════════════════════════════════════════════════════════════════════════════

function RuleListCard({
  rule,
  onEdit,
  onDelete,
}: {
  rule: ValidationRule;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const isCritical = rule.severity === "critical";
  const condText = rule.kind === "builtin"
    ? "Built-in check"
    : rule.condition
      ? conditionNodeLabel(rule.condition, rule.params)
      : "—";
  const gLabel = gateLabel(rule.gate);

  return (
    <div className="group flex items-start gap-3 rounded-card border border-hairline bg-chalk-white p-3 transition hover:border-hairline-strong hover:shadow-card">
      {/* Code badge */}
      <span className={`mt-0.5 inline-flex min-w-[36px] shrink-0 items-center justify-center rounded-pill px-2 py-0.5 font-mono text-[11px] font-bold ${isCritical ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
        {rule.code}
      </span>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[12px] font-semibold text-ink-navy">{rule.slug}</span>
          {rule.is_protected && (
            <span className="inline-flex items-center gap-0.5 text-[9px] font-medium text-muted">
              <svg className="h-2.5 w-2.5" viewBox="0 0 16 16" fill="none">
                <path d="M5 7V5a3 3 0 0 1 6 0v2M4 7h8v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7z" stroke="currentColor" strokeWidth="1.2" />
              </svg>
              Protected
            </span>
          )}
        </div>
        <code className="mt-0.5 block truncate text-[11px] text-muted">{condText}</code>
        {gLabel && (
          <div className="mt-0.5 flex items-center gap-1">
            <span className="text-[9px] font-medium uppercase tracking-wide text-muted">Gate:</span>
            <code className="truncate text-[10px] text-ink/60">{gLabel}</code>
          </div>
        )}
        <p className="mt-1 line-clamp-1 text-[11px] text-muted">{rule.messages?.en ?? "—"}</p>
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-1 opacity-0 transition group-hover:opacity-100">
        <button
          onClick={onEdit}
          className="tap flex h-7 w-7 items-center justify-center rounded-lg text-ink-navy transition hover:bg-mist-navy"
          title="Edit"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none">
            <path d="M11.5 2.5l2 2L6 12l-2.5.5L4 10l7.5-7.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          onClick={onDelete}
          className="tap flex h-7 w-7 items-center justify-center rounded-lg text-red-500 transition hover:bg-red-50"
          title="Deactivate"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none">
            <path d="M3.5 4.5h9M6 4.5V3a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 .5.5v1.5M5 4.5l.5 8a.5.5 0 0 0 .5.5h4a.5.5 0 0 0 .5-.5l.5-8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Rule Editor — full screen modal for creating/editing a rule
// ═══════════════════════════════════════════════════════════════════════════════

function RuleEditor({
  rule,
  metrics,
  garments,
  isNew,
  onClose,
  onSaved,
}: {
  rule: ValidationRule | null;
  metrics: MetricInfo[];
  garments: GarmentInfo[];
  isNew: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  // ─── Meta state ────────────────────────────────────────────────────────────
  const [slug, setSlug] = useState(rule?.slug ?? "");
  const [code, setCode] = useState(rule?.code ?? "");
  const [category, setCategory] = useState(rule?.category ?? "bust");
  const [severity, setSeverity] = useState(rule?.severity ?? "critical");
  const [garmentId, setGarmentId] = useState(rule?.garment_id ?? garments[0]?.id ?? "");
  const [isProtected, setIsProtected] = useState(rule?.is_protected ?? false);
  const [priorityOrder, setPriorityOrder] = useState(rule?.priority_order ?? 99);

  // ─── Condition (root node) ─────────────────────────────────────────────────
  const [condition, setCondition] = useState<ConditionNode | null>(rule?.condition ?? null);

  // ─── Gate ──────────────────────────────────────────────────────────────────
  const [gate, setGate] = useState<GateNode | null>(rule?.gate ?? null);
  const [gateEnabled, setGateEnabled] = useState(rule?.gate != null);

  // ─── Params ────────────────────────────────────────────────────────────────
  const [params, setParams] = useState<Record<string, number>>(rule?.params ?? {});

  // ─── Messages ──────────────────────────────────────────────────────────────
  const [messageEn, setMessageEn] = useState(rule?.messages?.en ?? "");
  const [messageHi, setMessageHi] = useState(rule?.messages?.hi ?? "");

  // ─── Save state ────────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // ─── Metric options ────────────────────────────────────────────────────────
  const metricOptions = useMemo(
    () =>
      metrics
        .filter((m) => m.code)
        .map((m) => ({
          value: m.code!,
          label: `${m.code}${m.labels?.en ? " — " + m.labels.en : ""}`,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [metrics],
  );

  // ─── Save handler ──────────────────────────────────────────────────────────
  async function handleSave() {
    setSaving(true);
    setSaveError(null);

    try {
      const token = getAdminToken();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      };

      const effectiveGate = gateEnabled ? gate : null;
      const messages: Record<string, string> = { en: messageEn.trim() };
      if (messageHi.trim()) messages.hi = messageHi.trim();

      if (isNew) {
        // ─── Create ──────────────────────────────────────────────────────
        const payload: RuleCreatePayload = {
          slug: slug.trim(),
          code: code.trim(),
          garment_id: garmentId,
          category,
          severity,
          kind: "expression",
          gate: effectiveGate,
          condition,
          params: Object.keys(params).length > 0 ? params : null,
          messages,
          is_protected: isProtected,
          priority_order: priorityOrder,
        };

        const res = await fetch(`${API_URL}/admin/validation-rules`, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error?.message ?? body?.detail ?? `Failed (${res.status})`);
        }
      } else {
        // ─── Update (PATCH = deactivate old + insert new version) ─────────
        const payload: RuleUpdatePayload = {
          code: code.trim(),
          garment_id: garmentId,
          category,
          severity,
          kind: "expression",
          gate: effectiveGate,
          condition,
          params: Object.keys(params).length > 0 ? params : null,
          messages,
          is_protected: isProtected,
          priority_order: priorityOrder,
          confirm: isProtected,
        };

        const res = await fetch(`${API_URL}/admin/validation-rules/${rule!.slug}`, {
          method: "PATCH",
          headers,
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error?.message ?? body?.detail ?? `Failed (${res.status})`);
        }
      }

      onSaved();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  // ══════ Render ════════════════════════════════════════════════════════════════

  const jsonPreview = useMemo(() => {
    const obj = {
      slug: slug.trim() || "(slug)",
      code: code.trim() || "(code)",
      category,
      severity,
      gate: gateEnabled ? gate : null,
      condition,
      params: Object.keys(params).length > 0 ? params : null,
      messages: { en: messageEn.trim() || "(message)" },
    };
    return JSON.stringify(obj, null, 2);
  }, [slug, code, category, severity, gateEnabled, gate, condition, params, messageEn]);

  return (
    <Modal
      open={true}
      title={isNew ? "Create Validation Rule" : `Edit: ${rule?.slug ?? ""}`}
      onClose={onClose}
      maxWidth="max-w-5xl"
    >
      <div className="space-y-5">
        {/* ─── Meta fields ────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <LabeledInput label="Slug *" hint="Unique identifier">
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              disabled={!isNew}
              placeholder="bust_lt_upper"
              className="w-full rounded-md border border-hairline-strong bg-chalk-white px-2 py-1.5 text-[12px] text-ink outline-none focus:border-ink-navy disabled:bg-mist-navy/50 disabled:text-muted"
            />
          </LabeledInput>

          <LabeledInput label="Code *" hint="Short code, e.g. A1">
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="A1"
              maxLength={8}
              className="w-full rounded-md border border-hairline-strong bg-chalk-white px-2 py-1.5 text-[12px] font-mono text-ink outline-none focus:border-ink-navy"
            />
          </LabeledInput>

          <LabeledInput label="Category">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-md border border-hairline-strong bg-chalk-white px-2 py-1.5 text-[12px] text-ink outline-none focus:border-ink-navy"
            >
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </LabeledInput>

          <LabeledInput label="Severity">
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value as "critical" | "non_critical")}
              className={`w-full rounded-md border border-hairline-strong px-2 py-1.5 text-[12px] font-medium outline-none focus:border-ink-navy ${severity === "critical" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}
            >
              {SEVERITY_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </LabeledInput>

          <LabeledInput label="Garment">
            <select
              value={garmentId}
              onChange={(e) => setGarmentId(e.target.value)}
              className="w-full rounded-md border border-hairline-strong bg-chalk-white px-2 py-1.5 text-[12px] text-ink outline-none focus:border-ink-navy"
            >
              {garments.map((g) => (
                <option key={g.id} value={g.id}>{getLabel(g.labels, g.slug, g.id)}</option>
              ))}
            </select>
          </LabeledInput>

          <LabeledInput label="Priority">
            <input
              type="number"
              value={priorityOrder}
              onChange={(e) => setPriorityOrder(Number(e.target.value))}
              className="w-full rounded-md border border-hairline-strong bg-chalk-white px-2 py-1.5 text-[12px] text-ink outline-none focus:border-ink-navy"
            />
          </LabeledInput>

          <LabeledInput label="Protected">
            <label className="flex h-[34px] cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                checked={isProtected}
                onChange={(e) => setIsProtected(e.target.checked)}
                className="h-4 w-4 accent-ink-navy"
              />
              <span className="text-[12px] text-ink-navy">Physics rule</span>
            </label>
          </LabeledInput>
        </div>

        {/* ─── Params Editor ─────────────────────────────────────────────── */}
        <ParamsEditor params={params} onChange={setParams} />

        {/* ─── Condition Builder ─────────────────────────────────────────── */}
        <div>
          <div className="mb-2 flex items-center gap-2">
            <h3 className="text-[13px] font-bold uppercase tracking-wide text-ink-navy">Condition</h3>
            <div className="h-px flex-1 bg-hairline" />
            {!condition && (
              <button
                onClick={() => setCondition({ cmp: { op: "<", lhs: { metric: "" }, rhs: { const: 0 } } })}
                className="tap inline-flex items-center gap-1 rounded-pill bg-ink-navy px-3 py-1 text-[11px] font-medium text-chalk-white"
              >
                <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none"><path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                Add Condition
              </button>
            )}
          </div>

          {condition ? (
            <div className="rounded-card border border-hairline bg-chalk-white p-3">
              <ConditionEditor
                node={condition}
                onChange={setCondition}
                metricOptions={metricOptions}
                params={params}
              />
            </div>
          ) : (
            <p className="rounded-card border border-dashed border-hairline-strong px-3 py-4 text-center text-[12px] text-muted">
              No condition defined yet. Click &ldquo;Add Condition&rdquo; to start.
            </p>
          )}
        </div>

        {/* ─── Gate Builder ──────────────────────────────────────────────── */}
        <div>
          <div className="mb-2 flex items-center gap-2">
            <h3 className="text-[13px] font-bold uppercase tracking-wide text-ink-navy">Gate (style filter)</h3>
            <div className="h-px flex-1 bg-hairline" />
            <label className="flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                checked={gateEnabled}
                onChange={(e) => {
                  setGateEnabled(e.target.checked);
                  if (e.target.checked && !gate) {
                    setGate({ in: { style: "sleeve", options: [] } });
                  }
                }}
                className="h-4 w-4 accent-ink-navy"
              />
              <span className="text-[11px] font-medium text-ink-navy">Enable gate</span>
            </label>
          </div>

          {gateEnabled && gate && (
            <div className="rounded-card border border-hairline bg-chalk-white p-3">
              <GateEditor gate={gate} onChange={setGate} />
              <p className="mt-2 text-[11px] text-muted">
                {gateLabel(gate) ?? "—"}
              </p>
            </div>
          )}

          {!gateEnabled && (
            <p className="text-[12px] text-muted italic">Always applies — no style gate.</p>
          )}
        </div>

        {/* ─── Messages ──────────────────────────────────────────────────── */}
        <div>
          <h3 className="mb-2 text-[13px] font-bold uppercase tracking-wide text-ink-navy">Messages</h3>
          <div className="space-y-2">
            <LabeledInput label="English *">
              <textarea
                value={messageEn}
                onChange={(e) => setMessageEn(e.target.value)}
                rows={2}
                placeholder="Bust full round ({bust_full_round}&quot;) is smaller than upper bust ({upper_bust}&quot;)..."
                className="w-full rounded-md border border-hairline-strong bg-chalk-white px-2 py-1.5 text-[12px] text-ink outline-none focus:border-ink-navy"
              />
            </LabeledInput>
            <LabeledInput label="Hindi (optional)">
              <textarea
                value={messageHi}
                onChange={(e) => setMessageHi(e.target.value)}
                rows={2}
                placeholder="हिंदी संदेश..."
                className="w-full rounded-md border border-hairline-strong bg-chalk-white px-2 py-1.5 text-[12px] text-ink outline-none focus:border-ink-navy"
              />
            </LabeledInput>
          </div>
          <p className="mt-1 text-[10px] text-muted">
            Use metric codes in curly braces as placeholders: e.g. &lbrace;bust_full_round&rbrace;
          </p>
        </div>

        {/* ─── JSON Preview ──────────────────────────────────────────────── */}
        <details className="group">
          <summary className="cursor-pointer text-[11px] font-medium text-muted hover:text-ink-navy">
            ▸ Live JSON Preview
          </summary>
          <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-ink-navy p-3 text-[11px] leading-relaxed text-chalk-white/90">
            {jsonPreview}
          </pre>
        </details>

        {/* ─── Error ─────────────────────────────────────────────────────── */}
        {saveError && (
          <div className="rounded-card border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-600">
            {saveError}
          </div>
        )}

        {/* ─── Actions ───────────────────────────────────────────────────── */}
        <div className="flex justify-end gap-2 border-t border-hairline pt-4">
          <button
            onClick={onClose}
            className="tap rounded-card border border-hairline-strong px-4 py-2 text-[13px] text-ink hover:bg-mist-navy"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !slug.trim() || !code.trim() || !messageEn.trim() || !condition}
            className="tap inline-flex items-center gap-2 rounded-card bg-ink-navy px-4 py-2 text-[13px] font-medium text-chalk-white transition hover:bg-ink-navy/90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving && (
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 20 20" fill="none">
                <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.25" />
                <path d="M10 2a8 8 0 0 1 8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            )}
            {isNew ? "Create Rule" : "Save Changes"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Params Editor — manage named numeric parameters
// ═══════════════════════════════════════════════════════════════════════════════

function ParamsEditor({
  params,
  onChange,
}: {
  params: Record<string, number>;
  onChange: (params: Record<string, number>) => void;
}) {
  const [newKey, setNewKey] = useState("");
  const [newVal, setNewVal] = useState("");

  function addParam() {
    const key = newKey.trim();
    if (!key) return;
    onChange({ ...params, [key]: Number(newVal) || 0 });
    setNewKey("");
    setNewVal("");
  }

  function updateParam(key: string, val: number) {
    onChange({ ...params, [key]: val });
  }

  function removeParam(key: string) {
    const next = { ...params };
    delete next[key];
    onChange(next);
  }

  const entries = Object.entries(params);

  return (
    <div className="rounded-card border border-hairline bg-mist-navy/30 p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <svg className="h-3.5 w-3.5 text-purple-600" viewBox="0 0 16 16" fill="none">
          <path d="M4 6h8M4 10h8M6 2v12M10 2v12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
        <span className="text-[12px] font-semibold text-ink-navy">Parameters</span>
        <span className="text-[10px] text-muted">— named thresholds you can reference in conditions</span>
      </div>

      {entries.length > 0 && (
        <div className="mb-2 space-y-1">
          {entries.map(([key, val]) => (
            <div key={key} className="flex items-center gap-2">
              <code className="inline-flex min-w-[80px] items-center rounded-md bg-purple-50 px-2 py-0.5 font-mono text-[11px] font-medium text-purple-700">
                {key}
              </code>
              <span className="text-muted">=</span>
              <input
                type="number"
                value={val}
                step="0.1"
                onChange={(e) => updateParam(key, Number(e.target.value))}
                className="w-24 rounded-md border border-hairline-strong bg-chalk-white px-2 py-0.5 text-[12px] text-ink outline-none focus:border-ink-navy"
              />
              <button
                onClick={() => removeParam(key)}
                className="tap flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-red-50 hover:text-red-500"
              >
                <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
                  <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add new param */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          placeholder="param name (e.g. tol)"
          className="flex-1 rounded-md border border-hairline-strong bg-chalk-white px-2 py-1 text-[12px] font-mono text-ink outline-none focus:border-ink-navy"
        />
        <input
          type="number"
          value={newVal}
          step="0.1"
          onChange={(e) => setNewVal(e.target.value)}
          placeholder="0"
          className="w-20 rounded-md border border-hairline-strong bg-chalk-white px-2 py-1 text-[12px] text-ink outline-none focus:border-ink-navy"
        />
        <button
          onClick={addParam}
          disabled={!newKey.trim()}
          className="tap inline-flex items-center gap-1 rounded-pill bg-purple-600 px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-purple-700 disabled:opacity-40"
        >
          <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
            <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          Add
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Condition Editor — recursive visual builder for condition nodes
// ═══════════════════════════════════════════════════════════════════════════════

function ConditionEditor({
  node,
  onChange,
  onDelete,
  metricOptions,
  params,
}: {
  node: ConditionNode;
  onChange: (node: ConditionNode) => void;
  onDelete?: () => void;
  metricOptions: { value: string; label: string }[];
  params: Record<string, number>;
}) {
  // ─── Determine node type ───────────────────────────────────────────────────
  const nodeType = getNodeKind(node);

  // ─── Switch node type ──────────────────────────────────────────────────────
  function changeType(type: string) {
    switch (type) {
      case "cmp":
        onChange({ cmp: { op: "<", lhs: { metric: metricOptions[0]?.value ?? "" }, rhs: { const: 0 } } });
        break;
      case "outside":
        onChange({ outside: { value: { metric: metricOptions[0]?.value ?? "" }, min: { const: 0 }, max: { const: 10 } } });
        break;
      case "all":
        onChange({ all: [{ cmp: { op: "<", lhs: { metric: metricOptions[0]?.value ?? "" }, rhs: { const: 0 } } }] });
        break;
      case "any":
        onChange({ any: [{ cmp: { op: "<", lhs: { metric: metricOptions[0]?.value ?? "" }, rhs: { const: 0 } } }] });
        break;
      case "not":
        onChange({ not: { cmp: { op: "<", lhs: { metric: metricOptions[0]?.value ?? "" }, rhs: { const: 0 } } } });
        break;
      case "in":
        onChange({ in: { style: "sleeve", options: [] } });
        break;
    }
  }

  return (
    <div className="space-y-2">
      {/* Type selector + delete */}
      <div className="flex items-center gap-2">
        <select
          value={nodeType}
          onChange={(e) => changeType(e.target.value)}
          className="rounded-md border border-hairline-strong bg-chalk-white px-2 py-1 text-[12px] font-medium text-ink-navy outline-none focus:border-ink-navy"
        >
          <option value="cmp">Comparison (A op B)</option>
          <option value="outside">Outside Range</option>
          <option value="all">ALL of (AND)</option>
          <option value="any">ANY of (OR)</option>
          <option value="not">NOT</option>
          <option value="in">Style In (gate check)</option>
        </select>

        {onDelete && (
          <button
            onClick={onDelete}
            className="tap flex h-6 w-6 items-center justify-center rounded text-red-500 transition hover:bg-red-50"
            title="Remove"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 14 14" fill="none">
              <path d="M3.5 4.5h9M6 4.5V3a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 .5.5v1.5M5 4.5l.5 8a.5.5 0 0 0 .5.5h4a.5.5 0 0 0 .5-.5l.5-8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </div>

      {/* ─── Type-specific editors ─────────────────────────────────────────── */}

      {"cmp" in node && node.cmp && (
        <ComparisonEditor
          cmp={node.cmp}
          onChange={(cmp) => onChange({ cmp })}
          metricOptions={metricOptions}
          params={params}
        />
      )}

      {"outside" in node && node.outside && (
        <div className="space-y-2 border-l-2 border-amber-300 pl-3">
          <div className="text-[11px] font-medium text-amber-700">Value to check:</div>
          <ValueNodeEditor
            node={node.outside.value}
            onChange={(value) => onChange({ outside: { ...node.outside!, value } })}
            metricOptions={metricOptions}
            params={params}
          />
          <div className="text-[11px] font-medium text-amber-700">Acceptable range (fails if OUTSIDE):</div>
          <div className="flex items-center gap-2">
            <ValueNodeEditor
              node={node.outside.min}
              onChange={(min) => onChange({ outside: { ...node.outside!, min } })}
              metricOptions={metricOptions}
              params={params}
            />
            <span className="text-[12px] text-muted">to</span>
            <ValueNodeEditor
              node={node.outside.max}
              onChange={(max) => onChange({ outside: { ...node.outside!, max } })}
              metricOptions={metricOptions}
              params={params}
            />
          </div>
        </div>
      )}

      {"all" in node && node.all !== undefined && (
        <ListEditor
          items={node.all}
          onChange={(all) => onChange({ all })}
          metricOptions={metricOptions}
          params={params}
          label="ALL of (every condition must be true)"
          color="indigo"
        />
      )}

      {"any" in node && node.any !== undefined && (
        <ListEditor
          items={node.any}
          onChange={(any) => onChange({ any })}
          metricOptions={metricOptions}
          params={params}
          label="ANY of (at least one must be true)"
          color="teal"
        />
      )}

      {"not" in node && node.not && (
        <div className="border-l-2 border-rose-300 pl-3">
          <div className="mb-1 text-[11px] font-medium text-rose-700">NOT (inverts the condition):</div>
          <ConditionEditor
            node={node.not}
            onChange={(not) => onChange({ not })}
            metricOptions={metricOptions}
            params={params}
          />
        </div>
      )}

      {"in" in node && node.in && (
        <div className="space-y-2 border-l-2 border-emerald-300 pl-3">
          <p className="text-[11px] text-muted">Fires when the style selection matches one of these options:</p>
          <div className="flex items-center gap-2">
            <select
              value={node.in.style}
              onChange={(e) => onChange({ in: { ...node.in!, style: e.target.value } })}
              className="rounded-md border border-hairline-strong bg-chalk-white px-2 py-1 text-[12px] text-ink outline-none focus:border-ink-navy"
            >
              {STYLE_FIELDS.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </div>
          <StyleOptionsEditor
            field={node.in.style}
            options={node.in.options}
            onChange={(options) => onChange({ in: { ...node.in!, options } })}
          />
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Comparison editor — op + LHS + RHS
// ═══════════════════════════════════════════════════════════════════════════════

function ComparisonEditor({
  cmp,
  onChange,
  metricOptions,
  params,
}: {
  cmp: { op: CmpOp; lhs: ValueNode; rhs: ValueNode };
  onChange: (cmp: { op: CmpOp; lhs: ValueNode; rhs: ValueNode }) => void;
  metricOptions: { value: string; label: string }[];
  params: Record<string, number>;
}) {
  return (
    <div className="space-y-2">
      {/* Operator */}
      <div className="flex items-center gap-2">
        <label className="text-[11px] font-medium text-ink-navy">Operator:</label>
        <select
          value={cmp.op}
          onChange={(e) => onChange({ ...cmp, op: e.target.value as CmpOp })}
          className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[12px] font-bold text-red-700 outline-none focus:border-red-400"
        >
          {CMP_OPS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* LHS */}
      <div>
        <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted">Left side</label>
        <ValueNodeEditor
          node={cmp.lhs}
          onChange={(lhs) => onChange({ ...cmp, lhs })}
          metricOptions={metricOptions}
          params={params}
        />
      </div>

      {/* RHS */}
      <div>
        <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted">Right side</label>
        <ValueNodeEditor
          node={cmp.rhs}
          onChange={(rhs) => onChange({ ...cmp, rhs })}
          metricOptions={metricOptions}
          params={params}
        />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Value node editor — pick metric/param/const/arithmetic
// ═══════════════════════════════════════════════════════════════════════════════

function ValueNodeEditor({
  node,
  onChange,
  metricOptions,
  params,
}: {
  node: ValueNode;
  onChange: (node: ValueNode) => void;
  metricOptions: { value: string; label: string }[];
  params: Record<string, number>;
}) {
  const kind = getValueKind(node);

  function changeKind(newKind: string) {
    switch (newKind) {
      case "metric": onChange({ metric: metricOptions[0]?.value ?? "" }); break;
      case "param": onChange({ param: Object.keys(params)[0] ?? "tol" }); break;
      case "const": onChange({ const: 0 }); break;
      case "sum": onChange({ sum: [{ metric: metricOptions[0]?.value ?? "" }, { const: 0 }] }); break;
      case "diff": onChange({ diff: [{ metric: metricOptions[0]?.value ?? "" }, { metric: metricOptions[1]?.value ?? metricOptions[0]?.value ?? "" }] }); break;
      case "mul": onChange({ mul: [{ param: Object.keys(params)[0] ?? "ratio" }, { metric: metricOptions[0]?.value ?? "" }] }); break;
      case "div": onChange({ div: [{ metric: metricOptions[0]?.value ?? "" }, { metric: metricOptions[1]?.value ?? metricOptions[0]?.value ?? "" }] }); break;
      case "abs": onChange({ abs: { metric: metricOptions[0]?.value ?? "" } }); break;
    }
  }

  return (
    <div className="rounded-md border border-hairline bg-warm-sand/20 p-2">
      {/* Kind selector */}
      <select
        value={kind}
        onChange={(e) => changeKind(e.target.value)}
        className="mb-2 w-full rounded-md border border-hairline-strong bg-chalk-white px-2 py-1 text-[11px] font-medium text-ink-navy outline-none focus:border-ink-navy"
      >
        <option value="metric">Metric (body measurement)</option>
        <option value="param">Parameter (named threshold)</option>
        <option value="const">Constant (literal number)</option>
        <option value="sum">Sum (A + B + ...)</option>
        <option value="diff">Difference (A − B)</option>
        <option value="mul">Multiply (A × B)</option>
        <option value="div">Divide (A ÷ B)</option>
        <option value="abs">Absolute value |A|</option>
      </select>

      {/* ─── Metric ──────────────────────────────────────────────────── */}
      {kind === "metric" && "metric" in node && (
        <select
          value={node.metric}
          onChange={(e) => onChange({ metric: e.target.value })}
          className="w-full rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-[12px] font-mono text-blue-700 outline-none focus:border-blue-400"
        >
          {metricOptions.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
      )}

      {/* ─── Param ───────────────────────────────────────────────────── */}
      {kind === "param" && "param" in node && (
        <select
          value={node.param}
          onChange={(e) => onChange({ param: e.target.value })}
          className="w-full rounded-md border border-purple-200 bg-purple-50 px-2 py-1 text-[12px] font-mono text-purple-700 outline-none focus:border-purple-400"
        >
          {Object.keys(params).length === 0 && (
            <option value="">No params defined — add one above</option>
          )}
          {Object.entries(params).map(([key, val]) => (
            <option key={key} value={key}>{key} (= {val})</option>
          ))}
        </select>
      )}

      {/* ─── Const ───────────────────────────────────────────────────── */}
      {kind === "const" && "const" in node && (
        <input
          type="number"
          value={node.const}
          step="0.1"
          onChange={(e) => onChange({ const: Number(e.target.value) })}
          className="w-full rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-[12px] font-mono text-gray-700 outline-none focus:border-gray-400"
        />
      )}

      {/* ─── Sum ─────────────────────────────────────────────────────── */}
      {kind === "sum" && "sum" in node && (
        <div className="space-y-1.5">
          {node.sum.map((child, i) => (
            <div key={i} className="flex items-center gap-1">
              {i > 0 && <span className="font-mono text-[14px] font-bold text-ink-navy">+</span>}
              <div className="flex-1">
                <ValueNodeEditor
                  node={child}
                  onChange={(newChild) => {
                    const next = [...node.sum];
                    next[i] = newChild;
                    onChange({ sum: next });
                  }}
                  metricOptions={metricOptions}
                  params={params}
                />
              </div>
              {node.sum.length > 2 && (
                <button
                  onClick={() => {
                    const next = node.sum.filter((_, idx) => idx !== i);
                    onChange({ sum: next });
                  }}
                  className="tap flex h-6 w-6 shrink-0 items-center justify-center rounded text-red-500 hover:bg-red-50"
                >
                  <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
                    <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              )}
            </div>
          ))}
          <button
            onClick={() => onChange({ sum: [...node.sum, { const: 0 }] })}
            className="tap inline-flex items-center gap-1 rounded-pill border border-hairline-strong px-2 py-0.5 text-[10px] font-medium text-ink-navy hover:bg-mist-navy"
          >
            <svg className="h-2.5 w-2.5" viewBox="0 0 10 10" fill="none">
              <path d="M5 1.5v7M1.5 5h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            Add operand
          </button>
        </div>
      )}

      {/* ─── Diff ────────────────────────────────────────────────────── */}
      {kind === "diff" && "diff" in node && (
        <div className="space-y-1.5">
          {node.diff.map((child, i) => (
            <div key={i} className="flex items-center gap-1">
              {i > 0 && <span className="font-mono text-[14px] font-bold text-ink-navy">−</span>}
              <div className="flex-1">
                <ValueNodeEditor
                  node={child}
                  onChange={(newChild) => {
                    const next = [...node.diff] as [ValueNode, ValueNode];
                    next[i] = newChild;
                    onChange({ diff: next });
                  }}
                  metricOptions={metricOptions}
                  params={params}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ─── Mul ─────────────────────────────────────────────────────── */}
      {kind === "mul" && "mul" in node && (
        <div className="space-y-1.5">
          {node.mul.map((child, i) => (
            <div key={i} className="flex items-center gap-1">
              {i > 0 && <span className="font-mono text-[14px] font-bold text-ink-navy">×</span>}
              <div className="flex-1">
                <ValueNodeEditor
                  node={child}
                  onChange={(newChild) => {
                    const next = [...node.mul] as [ValueNode, ValueNode];
                    next[i] = newChild;
                    onChange({ mul: next });
                  }}
                  metricOptions={metricOptions}
                  params={params}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ─── Div ─────────────────────────────────────────────────────── */}
      {kind === "div" && "div" in node && (
        <div className="space-y-1.5">
          {node.div.map((child, i) => (
            <div key={i} className="flex items-center gap-1">
              {i > 0 && <span className="font-mono text-[14px] font-bold text-ink-navy">÷</span>}
              <div className="flex-1">
                <ValueNodeEditor
                  node={child}
                  onChange={(newChild) => {
                    const next = [...node.div] as [ValueNode, ValueNode];
                    next[i] = newChild;
                    onChange({ div: next });
                  }}
                  metricOptions={metricOptions}
                  params={params}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ─── Abs ─────────────────────────────────────────────────────── */}
      {kind === "abs" && "abs" in node && (
        <div className="flex items-center gap-1">
          <span className="font-mono text-[16px] text-ink-navy">|</span>
          <div className="flex-1">
            <ValueNodeEditor
              node={node.abs}
              onChange={(inner) => onChange({ abs: inner })}
              metricOptions={metricOptions}
              params={params}
            />
          </div>
          <span className="font-mono text-[16px] text-ink-navy">|</span>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  List editor — for all/any condition arrays
// ═══════════════════════════════════════════════════════════════════════════════

function ListEditor({
  items,
  onChange,
  metricOptions,
  params,
  label,
  color,
}: {
  items: ConditionNode[];
  onChange: (items: ConditionNode[]) => void;
  metricOptions: { value: string; label: string }[];
  params: Record<string, number>;
  label: string;
  color: "indigo" | "teal";
}) {
  const colorClasses = {
    indigo: "border-indigo-300 text-indigo-700 bg-indigo-50",
    teal: "border-teal-300 text-teal-700 bg-teal-50",
  };

  function updateItem(i: number, node: ConditionNode) {
    const next = [...items];
    next[i] = node;
    onChange(next);
  }

  function removeItem(i: number) {
    onChange(items.filter((_, idx) => idx !== i));
  }

  function addItem() {
    onChange([...items, { cmp: { op: "<", lhs: { metric: metricOptions[0]?.value ?? "" }, rhs: { const: 0 } } }]);
  }

  return (
    <div className={`rounded-md border-l-2 pl-3 ${colorClasses[color].split(" ").slice(0, 1).join(" ")}`}>
      <div className={`mb-2 inline-block rounded-md px-2 py-0.5 text-[11px] font-bold uppercase ${colorClasses[color]}`}>
        {label}
      </div>
      <div className="space-y-2">
        {items.map((child, i) => (
          <div key={i} className="rounded-md border border-hairline bg-chalk-white p-2">
            <ConditionEditor
              node={child}
              onChange={(node) => updateItem(i, node)}
              onDelete={items.length > 1 ? () => removeItem(i) : undefined}
              metricOptions={metricOptions}
              params={params}
            />
          </div>
        ))}
      </div>
      <button
        onClick={addItem}
        className="tap mt-2 inline-flex items-center gap-1 rounded-pill border border-hairline-strong px-2.5 py-1 text-[11px] font-medium text-ink-navy hover:bg-mist-navy"
      >
        <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
          <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        Add condition
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Gate editor — simplified condition for style filtering
// ═══════════════════════════════════════════════════════════════════════════════

function GateEditor({ gate, onChange }: { gate: GateNode; onChange: (gate: GateNode) => void }) {
  // Simple in/not-in toggle
  const isIn = "in" in gate;
  const isNot = "not" in gate;

  function setMode(mode: "in" | "not") {
    if (mode === "in" && !isIn) {
      onChange({ in: { style: "sleeve", options: [] } });
    } else if (mode === "not" && !isNot) {
      onChange({ not: { in: { style: "sleeve", options: [] } } });
    }
  }

  // Extract the underlying in node
  const inNode = isIn ? gate.in : isNot && gate.not && "in" in gate.not ? gate.not.in : { style: "sleeve", options: [] };

  function updateIn(style: string, options: string[]) {
    if (isNot) {
      onChange({ not: { in: { style, options } } });
    } else {
      onChange({ in: { style, options } });
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-medium text-ink-navy">Apply this rule when:</span>
        <div className="flex rounded-md border border-hairline-strong overflow-hidden">
          <button
            onClick={() => setMode("in")}
            className={`px-3 py-1 text-[11px] font-medium transition ${isIn ? "bg-emerald-600 text-white" : "bg-chalk-white text-ink-navy hover:bg-mist-navy"}`}
          >
            IS one of
          </button>
          <button
            onClick={() => setMode("not")}
            className={`px-3 py-1 text-[11px] font-medium transition ${isNot ? "bg-rose-600 text-white" : "bg-chalk-white text-ink-navy hover:bg-mist-navy"}`}
          >
            IS NOT one of
          </button>
        </div>
      </div>

      <select
        value={inNode.style}
        onChange={(e) => updateIn(e.target.value, inNode.options)}
        className="rounded-md border border-hairline-strong bg-chalk-white px-2 py-1 text-[12px] text-ink outline-none focus:border-ink-navy"
      >
        {STYLE_FIELDS.map((f) => (
          <option key={f.value} value={f.value}>{f.label}</option>
        ))}
      </select>

      <StyleOptionsEditor
        field={inNode.style}
        options={inNode.options}
        onChange={(options) => updateIn(inNode.style, options)}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Style options editor — multi-select pills for variation slugs
// ═══════════════════════════════════════════════════════════════════════════════

const STYLE_VARIATIONS: Record<string, { value: string; label: string }[]> = {
  sleeve: [
    { value: "sleeveless", label: "Sleeveless" },
    { value: "cap", label: "Cap" },
    { value: "regular_short", label: "Short" },
    { value: "elbow", label: "Elbow" },
    { value: "three_quarter", label: "3/4" },
    { value: "full", label: "Full" },
  ],
  back_cut: [
    { value: "regular", label: "Regular" },
    { value: "deep", label: "Deep" },
    { value: "backless", label: "Backless" },
  ],
  tying: [
    { value: "hook", label: "Hook" },
    { value: "chain", label: "Chain" },
  ],
  front_neck: [
    { value: "round", label: "Round" },
    { value: "deep", label: "Deep" },
    { value: "sweetheart", label: "Sweetheart" },
  ],
};

function StyleOptionsEditor({
  field,
  options,
  onChange,
}: {
  field: string;
  options: string[];
  onChange: (options: string[]) => void;
}) {
  const available = STYLE_VARIATIONS[field] ?? [];

  function toggle(opt: string) {
    if (options.includes(opt)) {
      onChange(options.filter((o) => o !== opt));
    } else {
      onChange([...options, opt]);
    }
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {available.map((opt) => {
        const selected = options.includes(opt.value);
        return (
          <button
            key={opt.value}
            onClick={() => toggle(opt.value)}
            className={`tap inline-flex items-center gap-1 rounded-pill border px-2.5 py-1 text-[11px] font-medium transition ${
              selected
                ? "border-emerald-600 bg-emerald-600 text-white"
                : "border-hairline-strong bg-chalk-white text-ink-navy hover:bg-mist-navy"
            }`}
          >
            {selected && (
              <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
                <path d="M2.5 6.5L5 9l4.5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
            {opt.label}
          </button>
        );
      })}
      {available.length === 0 && (
        <span className="text-[11px] text-muted">No predefined options for &ldquo;{field}&rdquo;</span>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Small UI helpers
// ═══════════════════════════════════════════════════════════════════════════════

function LabeledInput({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[11px] font-medium text-ink-navy">{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-[10px] text-muted">{hint}</span>}
    </label>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Type guard helpers
// ═══════════════════════════════════════════════════════════════════════════════

function getNodeKind(node: ConditionNode): string {
  if ("cmp" in node) return "cmp";
  if ("outside" in node) return "outside";
  if ("all" in node) return "all";
  if ("any" in node) return "any";
  if ("not" in node) return "not";
  if ("in" in node) return "in";
  return "cmp";
}

function getValueKind(node: ValueNode): string {
  if ("metric" in node) return "metric";
  if ("param" in node) return "param";
  if ("const" in node) return "const";
  if ("sum" in node) return "sum";
  if ("diff" in node) return "diff";
  if ("mul" in node) return "mul";
  if ("div" in node) return "div";
  if ("abs" in node) return "abs";
  return "metric";
}
