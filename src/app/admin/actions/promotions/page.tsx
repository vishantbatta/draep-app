"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createPromotion,
  deletePromotion,
  fetchPromoOptions,
  generatePromoCode,
  listPromotions,
  updatePromotion,
  type Promotion,
  type PromotionScope,
  type PromoOptions,
} from "@/lib/admin-api";
import { parseRupeesInput, rupeesToInput } from "@/lib/money";
import { formatPrice } from "@/lib/pricing";
import {
  addonNodes,
  addonVariationNodes,
  areaNodes,
  componentNodes,
  garmentNodes,
  variationNodes,
  variationTypeNodes,
} from "@/lib/promo-pickers";
import {
  bucketSelection,
  EMPTY_REQUIRE_GROUP,
  requirementNodes,
  requireGroupSlugs,
  requireGroupsToScope,
  scopeToRequireGroups,
  type RequireGroupDraft,
} from "@/lib/promo-requires";
import { PickerField } from "./PromoPickerSheet";
import { PromoSettingsCard } from "./PromoSettingsCard";

// ─── Sub-tabs for Configure (shared) ───────────────────────────────────────────

const ACTION_TABS = [
  { key: "slot-scheduling", label: "Slot Scheduling", href: "/admin/actions/slot-scheduling" },
  { key: "serviceability", label: "Serviceability Areas", href: "/admin/actions/serviceability" },
  { key: "urls", label: "URLs", href: "/admin/actions/urls" },
  { key: "invoices", label: "Invoices", href: "/admin/actions/invoices" },
  { key: "promotions", label: "Promotions", href: "/admin/actions/promotions" },
  { key: "measurements", label: "Measurements", href: "/admin/measurements" },
  { key: "validation-rules", label: "Validation Rules", href: "/admin/catalogue/validation-rules" },
  { key: "sop-video", label: "SOP Video Generator", href: "/admin/actions/sop-video" },
] as const;

type ActionTabKey = (typeof ACTION_TABS)[number]["key"];

export default function PromotionsActionPage() {
  return (
    <Suspense fallback={null}>
      <PromotionsActionPageInner />
    </Suspense>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

// Money display/parse come from lib/money + lib/pricing: every stored money
// integer is WHOLE RUPEES (bug f — this page used to ÷100/×100 in paise).

function csvToList(s: string): string[] {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x !== "");
}

function listToCsv(list: string[] | undefined | null): string {
  return (list ?? []).join(", ");
}

/** datetime-local value (browser-local) ↔ ISO string for the wire. */
function isoToLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

type PromoStatus = "active" | "scheduled" | "expired" | "off";

function promoStatus(p: Promotion, now: number): PromoStatus {
  if (p.is_active === false) return "off";
  if (p.starts_at && new Date(p.starts_at).getTime() > now) return "scheduled";
  if (p.ends_at && new Date(p.ends_at).getTime() <= now) return "expired";
  return "active";
}

const STATUS_STYLES: Record<PromoStatus, string> = {
  active: "bg-accent-text/10 text-accent-text",
  scheduled: "bg-muted/15 text-muted",
  expired: "bg-error-bg text-error-text",
  off: "bg-error-bg text-error-text",
};

const STATUS_LABELS: Record<PromoStatus, string> = {
  active: "Live",
  scheduled: "Scheduled",
  expired: "Expired",
  off: "Turned off",
};

function discountLabel(p: Promotion): string {
  const v = p.value ?? 0;
  if (p.discount_type === "percent") return `${v}% off`;
  if (p.discount_type === "price_override") return `→ ${formatPrice(v)}`;
  return `${formatPrice(v)} off`;
}

function scopeSummary(p: Promotion): string {
  const s = p.scope ?? {};
  const bits: string[] = [];
  const target = (s.target as string) ?? "order";
  if (target === "order") bits.push("whole order");
  else if (target === "garment") bits.push(`garments: ${listToCsv(s.garment_slugs) || "—"}`);
  else if (target === "component") {
    bits.push(`components: ${listToCsv(s.component_slugs) || "—"}`);
    const leaves = [...(s.variation_slugs ?? []), ...(s.variation_type_slugs ?? [])];
    if (leaves.length) bits.push(`only: ${leaves.join(", ")}`);
  } else if (target === "addon") {
    bits.push(`add-ons: ${listToCsv(s.addon_slugs) || "—"}`);
    if (s.addon_variation_slugs?.length) bits.push(`only: ${s.addon_variation_slugs.join(", ")}`);
  }
  if (s.first_order_only) bits.push("first order only");
  if (s.payment_methods?.length) bits.push(s.payment_methods.join("/") + " only");
  if (s.requires?.length) bits.push(`combo ×${s.requires.length}`);
  if (s.service_area_ids?.length || s.pincodes?.length) bits.push("area-scoped");
  if (p.min_subtotal) bits.push(`min ${formatPrice(p.min_subtotal)}`);
  return bits.join(" · ");
}

// ─── Form state ─────────────────────────────────────────────────────────────

type Kind = "coupon" | "sale";
type DiscountType = "percent" | "flat" | "price_override";
type Target = "order" | "garment" | "component" | "addon";

interface FormDraft {
  kind: Kind;
  code: string;
  label: string; // labels.en — the customer-facing name
  description: string; // descriptions.en
  discountType: DiscountType;
  value: string; // percent: "25" · flat/override: rupees
  minSubtotal: string; // rupees
  target: Target;
  garmentSlugs: string; // CSV
  componentSlugs: string; // CSV
  variationSlugs: string; // CSV — optional component narrow
  variationTypeSlugs: string; // CSV — optional component narrow
  addonSlugs: string; // CSV
  addonVariationSlugs: string; // CSV — optional addon narrow
  serviceAreaIds: string; // CSV of ids
  pincodes: string; // CSV
  firstOrderOnly: boolean;
  prepaidOnly: boolean; // → payment_methods: ["online"]
  requires: RequireGroupDraft[]; // combo groups — ALL must hold
  maxQuantity: string;
  priority: string;
  startsAt: string; // datetime-local
  endsAt: string;
  usageLimitTotal: string;
  usageLimitPerUser: string;
  isActive: boolean;
  isStackable: boolean; // false = best-of-its-kind, never combines
}

const EMPTY_DRAFT: FormDraft = {
  kind: "coupon",
  code: "",
  label: "",
  description: "",
  discountType: "percent",
  value: "10",
  minSubtotal: "",
  target: "order",
  garmentSlugs: "",
  componentSlugs: "",
  variationSlugs: "",
  variationTypeSlugs: "",
  addonSlugs: "",
  addonVariationSlugs: "",
  serviceAreaIds: "",
  pincodes: "",
  firstOrderOnly: false,
  prepaidOnly: false,
  requires: [],
  maxQuantity: "",
  priority: "0",
  startsAt: "",
  endsAt: "",
  usageLimitTotal: "",
  usageLimitPerUser: "",
  isActive: true,
  isStackable: true,
};

function draftFromPromotion(p: Promotion): FormDraft {
  const s = (p.scope ?? {}) as PromotionScope;
  return {
    kind: (p.kind === "sale" ? "sale" : "coupon") as Kind,
    code: p.code ?? "",
    label: p.labels?.en ?? "",
    description: p.descriptions?.en ?? "",
    discountType: (p.discount_type === "percent" || p.discount_type === "price_override"
      ? p.discount_type
      : "flat") as DiscountType,
    value:
      p.discount_type === "percent"
        ? String(p.value ?? "")
        : rupeesToInput(p.value),
    minSubtotal: rupeesToInput(p.min_subtotal),
    target: (["order", "garment", "component", "addon"].includes(String(s.target))
      ? s.target
      : "order") as Target,
    garmentSlugs: listToCsv(s.garment_slugs),
    componentSlugs: listToCsv(s.component_slugs),
    variationSlugs: listToCsv(s.variation_slugs),
    variationTypeSlugs: listToCsv(s.variation_type_slugs),
    addonSlugs: listToCsv(s.addon_slugs),
    addonVariationSlugs: listToCsv(s.addon_variation_slugs),
    serviceAreaIds: listToCsv(s.service_area_ids),
    pincodes: listToCsv(s.pincodes),
    firstOrderOnly: s.first_order_only === true,
    prepaidOnly: (s.payment_methods ?? []).includes("online"),
    requires: scopeToRequireGroups(s),
    maxQuantity: p.max_quantity != null ? String(p.max_quantity) : "",
    priority: p.priority != null ? String(p.priority) : "0",
    startsAt: isoToLocalInput(p.starts_at),
    endsAt: isoToLocalInput(p.ends_at),
    usageLimitTotal: p.usage_limit_total != null ? String(p.usage_limit_total) : "",
    usageLimitPerUser: p.usage_limit_per_user != null ? String(p.usage_limit_per_user) : "",
    isActive: p.is_active !== false,
    isStackable: p.is_stackable !== false,
  };
}

function buildScope(d: FormDraft): PromotionScope {
  const scope: PromotionScope = { target: d.target };
  const gs = csvToList(d.garmentSlugs);
  const cs = csvToList(d.componentSlugs);
  const aslugs = csvToList(d.addonSlugs);
  const areas = csvToList(d.serviceAreaIds);
  const pins = csvToList(d.pincodes);
  const vs = csvToList(d.variationSlugs);
  const vts = csvToList(d.variationTypeSlugs);
  const avs = csvToList(d.addonVariationSlugs);
  if (gs.length) scope.garment_slugs = gs;
  if (cs.length) scope.component_slugs = cs;
  if (aslugs.length) scope.addon_slugs = aslugs;
  // narrows ride only on their own target, so stale draft fields never leak
  if (d.target === "component") {
    if (vs.length) scope.variation_slugs = vs;
    if (vts.length) scope.variation_type_slugs = vts;
  }
  if (d.target === "addon" && avs.length) scope.addon_variation_slugs = avs;
  if (areas.length) scope.service_area_ids = areas;
  if (pins.length) scope.pincodes = pins;
  if (d.firstOrderOnly) scope.first_order_only = true;
  if (d.prepaidOnly) scope.payment_methods = ["online"];
  const requires = requireGroupsToScope(d.requires);
  if (requires.length) scope.requires = requires;
  return scope;
}

/** Client-side mirror of the backend's A5 rules — the server stays authoritative. */
function validateDraft(d: FormDraft): string | null {
  const valueNum =
    d.discountType === "percent"
      ? parseInt(d.value, 10)
      : (parseRupeesInput(d.value) ?? NaN);
  if (d.kind === "coupon" && d.code.trim() === "") return "Coupons need a code.";
  if (d.kind === "sale" && d.code.trim() !== "")
    return "Sales can't have a code — they apply automatically at checkout.";
  if (!Number.isFinite(valueNum) || valueNum <= 0) return "Discount value must be greater than zero.";
  if (d.discountType === "percent" && valueNum > 100) return "Percent discount can't exceed 100.";
  if (d.discountType === "price_override" && d.target === "order")
    return "Price override needs a concrete target (garment, component or add-on).";
  if (d.target === "garment" && csvToList(d.garmentSlugs).length === 0)
    return "Garment target needs at least one garment slug.";
  if (d.target === "component" && csvToList(d.componentSlugs).length === 0)
    return "Component target needs at least one component slug.";
  if (d.target === "addon" && csvToList(d.addonSlugs).length === 0)
    return "Add-on target needs at least one add-on slug.";
  if (d.target !== "component" && (csvToList(d.variationSlugs).length || csvToList(d.variationTypeSlugs).length))
    return "Variation filters only apply to the Component target.";
  if (d.target !== "addon" && csvToList(d.addonVariationSlugs).length)
    return "Add-on variation filters only apply to the Add-on target.";
  if (d.startsAt && d.endsAt && new Date(d.endsAt).getTime() <= new Date(d.startsAt).getTime())
    return "End must be after start.";
  return null;
}

// ─── Page ───────────────────────────────────────────────────────────────────

function PromotionsActionPageInner() {
  const router = useRouter();
  const [activeActionTab] = useState<ActionTabKey>("promotions");

  const [promos, setPromos] = useState<Promotion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<FormDraft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);

  // Picker source of truth — one payload for every slug/UUID field.
  const [opts, setOpts] = useState<PromoOptions | null>(null);
  const [view, setView] = useState<"promotions" | "settings">("promotions");

  // ─── Push action sub-tabs to sidebar ─────────────────────────────────────
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("admin-sidebar-update", {
        detail: {
          items: ACTION_TABS.map((t) => ({
            label: t.label,
            active: activeActionTab === t.key,
            onClick: () => router.push(t.href),
          })),
        },
      }),
    );
  }, [activeActionTab, router]);

  const load = () => {
    setLoading(true);
    setError(null);
    listPromotions()
      .then((res) => {
        setPromos(res.promotions);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load promotions");
        setLoading(false);
      });
  };

  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Options for every picker; on failure we keep null → fields show a
  // "loading" state and the error banner above already tells the story.
  useEffect(() => {
    fetchPromoOptions()
      .then(setOpts)
      .catch(() => setOpts({ garments: [], addons: [], service_areas: [] }));
  }, []);

  // ─── Picker node trees (pure builders, memoized per dependency) ──────────
  const garmentSel = csvToList(draft.garmentSlugs);
  const componentSel = csvToList(draft.componentSlugs);
  const addonSel = csvToList(draft.addonSlugs);

  const garmentTree = useMemo(
    () => (opts ? garmentNodes(opts, garmentSel) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [opts, draft.garmentSlugs],
  );
  const componentTree = useMemo(
    () => (opts ? componentNodes(opts, componentSel) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [opts, draft.componentSlugs],
  );
  const variationTree = useMemo(
    () =>
      opts
        ? variationNodes(opts, csvToList(draft.variationSlugs), componentSel)
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [opts, draft.variationSlugs, draft.componentSlugs],
  );
  const variationTypeTree = useMemo(
    () =>
      opts
        ? variationTypeNodes(opts, csvToList(draft.variationTypeSlugs), componentSel)
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [opts, draft.variationTypeSlugs, draft.componentSlugs],
  );
  const addonTree = useMemo(
    () => (opts ? addonNodes(opts, addonSel) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [opts, draft.addonSlugs],
  );
  const addonVariationTree = useMemo(
    () =>
      opts
        ? addonVariationNodes(opts, csvToList(draft.addonVariationSlugs), addonSel)
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [opts, draft.addonVariationSlugs, draft.addonSlugs],
  );
  const areaTree = useMemo(
    () => (opts ? areaNodes(opts, csvToList(draft.serviceAreaIds)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [opts, draft.serviceAreaIds],
  );
  // One shared requirement tree for every group row — the sheet works on a
  // copy of the selection, so node.selected marks aren't needed per group.
  const requirementTree = useMemo(
    () => (opts ? requirementNodes(opts, []) : []),
    [opts],
  );

  const pickersLoading = opts === null;

  // Keep window badges honest while the page sits open.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  function patch<K extends keyof FormDraft>(key: K, value: FormDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    setSavedAt(null);
  }

  function openCreate() {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
    setShowForm(true);
    setError(null);
  }

  function openEdit(p: Promotion) {
    setEditingId(p.id);
    setDraft(draftFromPromotion(p));
    setShowForm(true);
    setError(null);
  }

  async function handleGenerateCode() {
    if (generating) return;
    setGenerating(true);
    setError(null);
    try {
      const code = await generatePromoCode();
      patch("kind", "coupon");
      patch("code", code);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate code");
    } finally {
      setGenerating(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;

    const problem = validateDraft(draft);
    if (problem) {
      setError(problem);
      return;
    }

    setSaving(true);
    setError(null);

    const startsIso = draft.startsAt ? new Date(draft.startsAt).toISOString() : null;
    const endsIso = draft.endsAt ? new Date(draft.endsAt).toISOString() : null;
    const value =
      draft.discountType === "percent"
        ? parseInt(draft.value, 10)
        : (parseRupeesInput(draft.value) as number);

    // Explicit keys (even nulls) so optional fields can be cleared on edit.
    const payload = {
      code: draft.kind === "coupon" ? draft.code.trim() : null,
      labels: draft.label.trim() !== "" ? { en: draft.label.trim() } : null,
      descriptions: draft.description.trim() !== "" ? { en: draft.description.trim() } : null,
      discount_type: draft.discountType,
      value,
      min_subtotal: parseRupeesInput(draft.minSubtotal),
      scope: buildScope(draft),
      max_quantity: draft.maxQuantity.trim() !== "" ? parseInt(draft.maxQuantity, 10) : null,
      priority: draft.priority.trim() !== "" ? parseInt(draft.priority, 10) || 0 : 0,
      starts_at: startsIso,
      ends_at: endsIso,
      usage_limit_total:
        draft.usageLimitTotal.trim() !== "" ? parseInt(draft.usageLimitTotal, 10) : null,
      usage_limit_per_user:
        draft.usageLimitPerUser.trim() !== "" ? parseInt(draft.usageLimitPerUser, 10) : null,
      is_active: draft.isActive,
      is_stackable: draft.isStackable,
    };

    const done = () => {
      setSaving(false);
      setShowForm(false);
      setSavedAt(Date.now());
      load();
    };
    const fail = (err: unknown) => {
      setError(err instanceof Error ? err.message : "Failed to save promotion");
      setSaving(false);
    };

    try {
      if (editingId) {
        await updatePromotion(editingId, payload);
      } else {
        await createPromotion({ ...payload, kind: draft.kind });
      }
      done();
    } catch (err) {
      fail(err);
    }
  }

  function handleDelete(p: Promotion) {
    const name = p.code ?? p.labels?.en ?? p.id;
    if (!window.confirm(`Delete ${name}? This cannot be undone.`)) return;
    deletePromotion(p.id)
      .then(() => {
        setSavedAt(Date.now());
        load();
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to delete promotion"));
  }

  const inputCls =
    "w-full rounded-pill border border-hairline-strong bg-chalk-white px-3 py-2 text-data text-ink outline-none focus:border-accent-text";

  const labelCls = "mb-1.5 block font-mono text-eyebrow text-ink-navy";
  const hintCls = "mt-1 text-[11px] text-muted";

  function Choice<T extends string>(props: {
    value: T;
    options: readonly { v: T; label: string; disabled?: boolean }[];
    onSelect: (v: T) => void;
  }) {
    return (
      <div className="flex flex-wrap gap-2">
        {props.options.map((o) => (
          <button
            key={o.v}
            type="button"
            disabled={o.disabled}
            onClick={() => props.onSelect(o.v)}
            className={`tap rounded-pill border px-4 py-2 text-caption font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
              props.value === o.v
                ? "border-ink-navy bg-ink-navy text-chalk-white"
                : "border-hairline-strong bg-chalk-white text-ink-navy hover:bg-mist-navy"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="px-4 py-4 md:px-6 md:py-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="font-heading text-h3 font-semibold text-ink-navy md:text-h2">Promotions</h1>
          <p className="mt-0.5 text-[12px] text-muted">
            Coupons (customer enters a code) and sales (apply automatically).
          </p>
          {/* Promotions ⇄ Settings — settings used to be its own route */}
          <div className="mt-3 inline-flex rounded-pill border border-hairline-strong bg-chalk-white p-1">
            {(["promotions", "settings"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={`tap rounded-pill px-4 py-1.5 text-caption font-medium transition ${
                  view === v
                    ? "bg-ink-navy text-chalk-white"
                    : "text-ink-navy hover:bg-mist-navy"
                }`}
              >
                {v === "promotions" ? "Promotions" : "Settings"}
              </button>
            ))}
          </div>
        </div>
        {view === "promotions" && (
          <div className="flex items-center gap-2">
            {savedAt && !error && (
              <span className="rounded-pill bg-accent-text/10 px-3 py-1 text-caption font-medium text-accent-text">
                Saved
              </span>
            )}
            <button
              type="button"
              onClick={openCreate}
              className="tap rounded-pill bg-ink-navy px-5 py-2.5 text-caption font-medium text-chalk-white transition hover:bg-ink-navy/90"
            >
              + New Promotion
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-card border border-error-border bg-error-bg px-4 py-3 text-caption text-error-text">
          {error}
        </div>
      )}

      {view === "settings" ? (
        <PromoSettingsCard />
      ) : (
        <>
      {/* ─── Inline create / edit form ─────────────────────────────────────── */}
      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="mb-6 max-w-2xl space-y-6 rounded-card border border-hairline bg-chalk-white p-4 shadow-card md:p-6"
        >
          <h2 className="font-heading text-h4 font-semibold text-ink-navy">
            {editingId ? "Edit promotion" : "New promotion"}
          </h2>

          {/* Basics */}
          <section>
            <label className={labelCls}>Type</label>
            <Choice
              value={draft.kind}
              options={[
                { v: "coupon", label: "Coupon (code)", disabled: editingId != null },
                { v: "sale", label: "Sale (auto)", disabled: editingId != null },
              ]}
              onSelect={(v) => patch("kind", v)}
            />
            <p className={hintCls}>
              Coupons need a code from the customer. Sales apply to every eligible cart — shown
              as a banner.
            </p>

            {draft.kind === "coupon" && (
              <div className="mt-4">
                <label className={labelCls}>Code</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={draft.code}
                    onChange={(e) => patch("code", e.target.value.toUpperCase())}
                    placeholder="DRAEP-XY2A"
                    className={`${inputCls} font-mono`}
                  />
                  <button
                    type="button"
                    onClick={handleGenerateCode}
                    disabled={generating}
                    className="tap shrink-0 rounded-pill border border-hairline-strong bg-chalk-white px-3 py-2 text-[11px] font-medium text-ink-navy transition hover:bg-mist-navy disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {generating ? "…" : "Generate"}
                  </button>
                </div>
                <p className={hintCls}>Saved uppercase; customers can type any case.</p>
              </div>
            )}

            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className={labelCls}>
                  Name <span className="text-muted">(labels.en)</span>
                </label>
                <input
                  type="text"
                  value={draft.label}
                  onChange={(e) => patch("label", e.target.value)}
                  placeholder="e.g. Diwali Dhamaka"
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>
                  Description <span className="text-muted">(optional)</span>
                </label>
                <input
                  type="text"
                  value={draft.description}
                  onChange={(e) => patch("description", e.target.value)}
                  placeholder="Shown with the discount at checkout"
                  className={inputCls}
                />
              </div>
            </div>
          </section>

          {/* Discount */}
          <section>
            <label className={labelCls}>Discount</label>
            <Choice
              value={draft.discountType}
              options={[
                { v: "percent", label: "% off" },
                { v: "flat", label: "₹ off" },
                { v: "price_override", label: "Price → ₹" },
              ]}
              onSelect={(v) => patch("discountType", v)}
            />
            <div className="mt-3 max-w-[220px]">
              <label className={labelCls}>
                {draft.discountType === "percent"
                  ? "Percent (1–100)"
                  : draft.discountType === "flat"
                    ? "Amount off (₹)"
                    : "New price (₹)"}
              </label>
              <input
                type="number"
                min={0}
                step={draft.discountType === "percent" ? 1 : 0.5}
                value={draft.value}
                onChange={(e) => patch("value", e.target.value)}
                className={inputCls}
                required
              />
              {draft.discountType === "price_override" && (
                <p className={hintCls}>
                  The line&apos;s price becomes this amount; the difference shows as a discount.
                </p>
              )}
            </div>
          </section>

          {/* Target */}
          <section>
            <label className={labelCls}>Applies to</label>
            <Choice
              value={draft.target}
              options={[
                { v: "order", label: "Whole order" },
                { v: "garment", label: "Garment type" },
                { v: "component", label: "Component" },
                { v: "addon", label: "Add-on" },
              ]}
              onSelect={(v) => patch("target", v)}
            />

            {draft.target === "garment" && (
              <div className="mt-3">
                <PickerField
                  label="Garments"
                  hint="Discount every line of the picked garment types."
                  nodes={garmentTree}
                  value={garmentSel}
                  onChange={(next) => patch("garmentSlugs", next.join(", "))}
                  loading={pickersLoading}
                  placeholder="Pick garment types"
                />
              </div>
            )}
            {draft.target === "component" && (
              <>
                <div className="mt-3">
                  <PickerField
                    label="Components"
                    hint="Drill garment → component. e.g. “free sleeves” = 100% over the sleeve line."
                    nodes={componentTree}
                    value={componentSel}
                    onChange={(next) => patch("componentSlugs", next.join(", "))}
                    loading={pickersLoading}
                    placeholder="Pick components"
                  />
                </div>
                <div className="mt-3">
                  <PickerField
                    label="Variations (optional)"
                    hint="Narrow to specific selections — e.g. only “sweetheart” necklines. Blank = all."
                    nodes={variationTree}
                    value={csvToList(draft.variationSlugs)}
                    onChange={(next) => patch("variationSlugs", next.join(", "))}
                    loading={pickersLoading}
                    placeholder="All variations"
                  />
                </div>
                <div className="mt-3">
                  <PickerField
                    label="Variation types (optional)"
                    hint="Sub-types under a variation — a line matches if its variation OR its type is listed."
                    nodes={variationTypeTree}
                    value={csvToList(draft.variationTypeSlugs)}
                    onChange={(next) => patch("variationTypeSlugs", next.join(", "))}
                    loading={pickersLoading}
                    placeholder="All types"
                  />
                </div>
              </>
            )}
            {draft.target === "addon" && (
              <>
                <div className="mt-3">
                  <PickerField
                    label="Add-ons"
                    hint="e.g. “free latkan” = 100% over the add-on."
                    nodes={addonTree}
                    value={addonSel}
                    onChange={(next) => patch("addonSlugs", next.join(", "))}
                    loading={pickersLoading}
                    placeholder="Pick add-ons"
                  />
                </div>
                <div className="mt-3">
                  <PickerField
                    label="Add-on variations (optional)"
                    hint="Narrow to specific add-on variations (e.g. only “light” latkan)."
                    nodes={addonVariationTree}
                    value={csvToList(draft.addonVariationSlugs)}
                    onChange={(next) => patch("addonVariationSlugs", next.join(", "))}
                    loading={pickersLoading}
                    placeholder="All add-on variations"
                  />
                </div>
              </>
            )}

            {draft.target !== "order" && (
              <div className="mt-3 max-w-[220px]">
                <label className={labelCls}>
                  Max quantity <span className="text-muted">(optional)</span>
                </label>
                <input
                  type="number"
                  min={1}
                  value={draft.maxQuantity}
                  onChange={(e) => patch("maxQuantity", e.target.value)}
                  placeholder="All matches"
                  className={inputCls}
                />
                <p className={hintCls}>Discount at most this many matched items.</p>
              </div>
            )}
          </section>

          {/* Conditions */}
          <section className="space-y-4">
            <div className="max-w-[220px]">
              <label className={labelCls}>
                Minimum order <span className="text-muted">(₹, optional)</span>
              </label>
              <input
                type="number"
                min={0}
                step={0.5}
                value={draft.minSubtotal}
                onChange={(e) => patch("minSubtotal", e.target.value)}
                placeholder="No minimum"
                className={inputCls}
              />
              <p className={hintCls}>“₹500 off on ₹2,500” → 2500 here.</p>
            </div>

            <div className="flex flex-col gap-2">
              <label className="flex cursor-pointer items-center gap-2 text-caption text-ink-navy">
                <input
                  type="checkbox"
                  checked={draft.firstOrderOnly}
                  onChange={(e) => patch("firstOrderOnly", e.target.checked)}
                  className="h-4 w-4 accent-ink-navy"
                />
                First order only
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-caption text-ink-navy">
                <input
                  type="checkbox"
                  checked={draft.prepaidOnly}
                  onChange={(e) => patch("prepaidOnly", e.target.checked)}
                  className="h-4 w-4 accent-ink-navy"
                />
                Prepaid (online) only — not on COD
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-caption text-ink-navy">
                <input
                  type="checkbox"
                  checked={draft.isStackable}
                  onChange={(e) => patch("isStackable", e.target.checked)}
                  className="h-4 w-4 accent-ink-navy"
                />
                Stackable — combines with others of its kind
              </label>
            </div>

            <div>
              <span className="mb-1.5 block font-mono text-eyebrow text-ink-navy">
                Combo — cart must contain{" "}
                <span className="text-muted">(optional · every row must hold)</span>
              </span>
              <p className={hintCls}>
                Each row is one requirement; pick any tier in the sheet — e.g. row 1:
                Blouse → Sleeve style → “Sleeveless”, row 2: Blouse → Front neck →
                “V shape” → ₹100 off. Multiple picks in one row = any of them counts.
              </p>
              <div className="mt-2 flex flex-col gap-3">
                {draft.requires.map((g, i) => (
                  <div key={i} className="rounded-2xl border border-hairline-strong p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="font-mono text-eyebrow text-ink-navy">
                        Requirement {i + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          patch(
                            "requires",
                            draft.requires.filter((_, j) => j !== i),
                          )
                        }
                        className="text-caption text-muted underline underline-offset-2 hover:text-error-text"
                      >
                        Remove
                      </button>
                    </div>
                    <PickerField
                      hideLabel
                      label={`Requirement ${i + 1}`}
                      nodes={requirementTree}
                      value={requireGroupSlugs(g)}
                      onChange={(next) =>
                        patch(
                          "requires",
                          draft.requires.map((row, j) =>
                            j === i
                              ? opts
                                ? bucketSelection(opts, next, g)
                                : row
                              : row,
                          ),
                        )
                      }
                      loading={pickersLoading}
                      placeholder="Any garment / variation / add-on…"
                    />
                    {requireGroupSlugs(g).length > 0 && (
                      <div className="mt-2 max-w-[220px]">
                        <label className={labelCls}>
                          Min quantity{" "}
                          <span className="text-muted">(of matching garments)</span>
                        </label>
                        <input
                          type="number"
                          min={1}
                          value={g.minQty}
                          onChange={(e) =>
                            patch(
                              "requires",
                              draft.requires.map((row, j) =>
                                j === i ? { ...row, minQty: e.target.value } : row,
                              ),
                            )
                          }
                          className={inputCls}
                        />
                      </div>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => patch("requires", [...draft.requires, { ...EMPTY_REQUIRE_GROUP }])}
                  className="self-start rounded-pill border border-hairline-strong bg-chalk-white px-4 py-2 text-caption font-medium text-ink-navy transition hover:border-ink-navy/40"
                >
                  + Add requirement
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <PickerField
                label="Service areas (optional)"
                hint="Only carts addressed inside these areas. Pincodes below narrow further."
                nodes={areaTree}
                value={csvToList(draft.serviceAreaIds)}
                onChange={(next) => patch("serviceAreaIds", next.join(", "))}
                loading={pickersLoading}
                placeholder="All areas"
              />
              <div>
                <label className={labelCls}>
                  Pincodes <span className="text-muted">(optional CSV)</span>
                </label>
                <input
                  type="text"
                  value={draft.pincodes}
                  onChange={(e) => patch("pincodes", e.target.value)}
                  placeholder="500001, 500034"
                  className={`${inputCls} font-mono`}
                />
              </div>
            </div>
          </section>

          {/* Window & limits */}
          <section>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className={labelCls}>
                  Starts <span className="text-muted">(optional)</span>
                </label>
                <input
                  type="datetime-local"
                  value={draft.startsAt}
                  onChange={(e) => patch("startsAt", e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>
                  Ends <span className="text-muted">(optional)</span>
                </label>
                <input
                  type="datetime-local"
                  value={draft.endsAt}
                  onChange={(e) => patch("endsAt", e.target.value)}
                  className={inputCls}
                />
              </div>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <label className={labelCls}>
                  Total uses <span className="text-muted">(optional)</span>
                </label>
                <input
                  type="number"
                  min={1}
                  value={draft.usageLimitTotal}
                  onChange={(e) => patch("usageLimitTotal", e.target.value)}
                  placeholder="Unlimited"
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>
                  Uses / customer <span className="text-muted">(optional)</span>
                </label>
                <input
                  type="number"
                  min={1}
                  value={draft.usageLimitPerUser}
                  onChange={(e) => patch("usageLimitPerUser", e.target.value)}
                  placeholder="Unlimited"
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Priority</label>
                <input
                  type="number"
                  min={0}
                  value={draft.priority}
                  onChange={(e) => patch("priority", e.target.value)}
                  className={inputCls}
                />
                <p className={hintCls}>Higher wins when stacking is “best single”.</p>
              </div>
            </div>
          </section>

          {/* Status */}
          <section>
            <label className={labelCls}>Status</label>
            <Choice
              value={draft.isActive ? "on" : "off"}
              options={[
                { v: "on", label: "Active" },
                { v: "off", label: "Turned off" },
              ]}
              onSelect={(v) => patch("isActive", v === "on")}
            />
          </section>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="tap rounded-pill bg-ink-navy px-6 py-2.5 text-caption font-medium text-chalk-white transition hover:bg-ink-navy/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Saving…" : editingId ? "Save Changes" : "Create Promotion"}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="tap rounded-pill border border-hairline-strong bg-chalk-white px-5 py-2.5 text-caption font-medium text-ink-navy transition hover:bg-mist-navy"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* ─── Promotions table ───────────────────────────────────────────── */}
      {loading ? (
        <div className="flex h-48 items-center justify-center rounded-card border border-hairline bg-chalk-white">
          <span className="text-caption text-muted">Loading…</span>
        </div>
      ) : promos.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-card border border-hairline bg-chalk-white">
          <span className="text-caption text-muted">No promotions yet.</span>
          <span className="text-[12px] text-muted">
            Create a coupon for code-entry discounts, or a sale that applies automatically.
          </span>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto rounded-card border border-hairline bg-chalk-white shadow-card md:block">
            <table className="w-full text-left text-data">
              <thead>
                <tr className="border-b border-hairline bg-mist-navy/50">
                  <th className="px-4 py-3 font-mono text-eyebrow text-ink-navy">Code / Kind</th>
                  <th className="px-4 py-3 font-mono text-eyebrow text-ink-navy">Name</th>
                  <th className="px-4 py-3 font-mono text-eyebrow text-ink-navy">Discount</th>
                  <th className="px-4 py-3 font-mono text-eyebrow text-ink-navy">Scope</th>
                  <th className="px-4 py-3 font-mono text-eyebrow text-ink-navy">Window</th>
                  <th className="px-4 py-3 font-mono text-eyebrow text-ink-navy">Limits</th>
                  <th className="px-4 py-3 font-mono text-eyebrow text-ink-navy">Status</th>
                  <th className="px-4 py-3 font-mono text-eyebrow text-ink-navy">Actions</th>
                </tr>
              </thead>
              <tbody>
                {promos.map((p) => {
                  const status = promoStatus(p, now);
                  return (
                    <tr key={p.id} className="group border-b border-hairline last:border-b-0 hover:bg-mist-navy/30">
                      <td className="whitespace-nowrap px-4 py-3">
                        {p.code ? (
                          <span className="font-mono text-ink">{p.code}</span>
                        ) : (
                          <span className="rounded-pill bg-muted/15 px-2 py-0.5 text-[11px] text-muted">SALE</span>
                        )}
                      </td>
                      <td className="max-w-[180px] truncate px-4 py-3 text-muted" title={p.labels?.en ?? ""}>
                        {p.labels?.en || "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-ink">
                        {discountLabel(p)}
                      </td>
                      <td className="max-w-[220px] truncate px-4 py-3 text-muted" title={scopeSummary(p)}>
                        {scopeSummary(p)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted">
                        {p.starts_at || p.ends_at
                          ? `${formatWhen(p.starts_at)} → ${formatWhen(p.ends_at)}`
                          : "always"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted">
                        {[
                          p.usage_limit_total != null ? `${p.usage_limit_total} total` : null,
                          p.usage_limit_per_user != null ? `${p.usage_limit_per_user}/user` : null,
                          p.priority ? `p${p.priority}` : null,
                          p.is_stackable === false ? "solo" : null,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-pill px-2.5 py-1 text-[11px] font-medium ${STATUS_STYLES[status]}`}>
                          {STATUS_LABELS[status]}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => openEdit(p)}
                            className="tap rounded-pill px-2.5 py-1 text-[11px] font-medium text-ink-navy transition hover:bg-mist-navy"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(p)}
                            className="tap rounded-pill px-2.5 py-1 text-[11px] font-medium text-error-text transition hover:bg-error-bg"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-3 md:hidden">
            {promos.map((p) => {
              const status = promoStatus(p, now);
              return (
                <div key={p.id} className="rounded-card border border-hairline bg-chalk-white p-4 shadow-card">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="font-mono text-data text-ink">
                      {p.code ?? <span className="rounded-pill bg-muted/15 px-2 py-0.5 text-[11px] text-muted">SALE</span>}
                    </span>
                    <span className={`shrink-0 rounded-pill px-2.5 py-1 text-[11px] font-medium ${STATUS_STYLES[status]}`}>
                      {STATUS_LABELS[status]}
                    </span>
                  </div>
                  <p className="mb-1 text-caption text-ink">{discountLabel(p)}</p>
                  {p.labels?.en && <p className="mb-1 text-caption text-muted">{p.labels.en}</p>}
                  <p className="mb-1 text-[11px] text-muted">{scopeSummary(p)}</p>
                  <p className="mb-3 text-[11px] text-muted">
                    {p.starts_at || p.ends_at ? `${formatWhen(p.starts_at)} → ${formatWhen(p.ends_at)}` : "always"}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => openEdit(p)}
                      className="tap rounded-pill border border-hairline-strong bg-chalk-white px-3 py-1.5 text-[11px] font-medium text-ink-navy transition hover:bg-mist-navy"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(p)}
                      className="tap rounded-pill border border-error-border bg-chalk-white px-3 py-1.5 text-[11px] font-medium text-error-text transition hover:bg-error-bg"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
        </>
      )}
    </div>
  );
}
