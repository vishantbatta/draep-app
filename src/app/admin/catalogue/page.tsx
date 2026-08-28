"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Garment,
  GarmentUpdateInput,
  StyleComponent,
  StyleComponentUpdateInput,
  Variation,
  VariationUpdateInput,
  VariationType,
  VariationTypeUpdateInput,
  Addon,
  AddonUpdateInput,
  AddonCreateInput,
  AddonVariation,
  AddonVariationUpdateInput,
  createGarment,
  updateGarment,
  deleteGarment,
  createStyleComponent,
  updateStyleComponent,
  deleteStyleComponent,
  createVariation,
  updateVariation,
  deleteVariation,
  createVariationType,
  updateVariationType,
  deleteVariationType,
  createAddon,
  updateAddon,
  deleteAddon,
  createAddonVariation,
  updateAddonVariation,
  deleteAddonVariation,
  fetchAll,
  fetchByParent,
  getLabel,
  getDescription,
  updatePriorityOrder,
  type MeasurableEntityType,
  type AiEntityType,
} from "@/lib/admin-api";
import {
  Card,
  Breadcrumb,
  Crumb,
  SectionHeader,
  Modal,
  Field,
  TextInput,
  Select,
  LoadingState,
  ErrorState,
  EmptyState,
  ConfirmDelete,
  ReorderableCardGrid,
} from "./_shared/catalogue-helpers";
import { AddonMatrixModal } from "./AddonMatrixModal";
import { EntityMetricsSection } from "./_shared/EntityMetricsSection";
import {
  BulkGenerateButton,
  BulkGenerateModal,
  type BulkEntity,
} from "./_shared/BulkGenerateModal";
import {
  AiErrorNote,
  AiImagePanel,
  AiRowButton,
  AddAssetUrlInput,
  AssetImageGrid,
  useAiDescription,
  useAiImage,
  type AiEntityContext,
} from "../_shared/ai-content";

// ═══════════════════════════════════════════════════════════════════════════════
// Language multi-row editor (same pattern as actions tab)
// ═══════════════════════════════════════════════════════════════════════════════

const LANGUAGE_OPTIONS = [
  { code: "en", label: "English" },
  { code: "hi", label: "Hindi" },
  { code: "ta", label: "Tamil" },
  { code: "te", label: "Telugu" },
  { code: "kn", label: "Kannada" },
  { code: "ml", label: "Malayalam" },
  { code: "bn", label: "Bengali" },
  { code: "mr", label: "Marathi" },
  { code: "gu", label: "Gujarati" },
  { code: "pa", label: "Punjabi" },
];

interface LangRow {
  id: string;
  lang: string;
  value: string;
}

let _langRowCounter = 0;
function newLangRow(lang: string = "", value: string = ""): LangRow {
  _langRowCounter += 1;
  return { id: `lr${_langRowCounter}`, lang, value };
}

function dictToLangRows(dict: Record<string, string> | null): LangRow[] {
  if (!dict) return [];
  return Object.entries(dict).map(([lang, value]) => newLangRow(lang, value));
}

function langRowsToDict(rows: LangRow[]): Record<string, string> | null {
  const dict: Record<string, string> = {};
  for (const row of rows) {
    if (row.lang && row.value.trim()) dict[row.lang] = row.value.trim();
  }
  return Object.keys(dict).length > 0 ? dict : null;
}

function LangRowEditor({
  rows,
  onChange,
  label,
  multiline,
  placeholder,
  aiAction,
  aiBusyLang,
}: {
  rows: LangRow[];
  onChange: (rows: LangRow[]) => void;
  label: string;
  multiline?: boolean;
  placeholder?: string;
  /** When set, renders an AI button on each row (fills this language). */
  aiAction?: (lang: string) => void;
  aiBusyLang?: string | null;
}) {
  const usedLangs = new Set(rows.map((r) => r.lang));
  const availableLangs = LANGUAGE_OPTIONS.filter((o) => !usedLangs.has(o.code));

  function updateRow(id: string, patch: Partial<LangRow>) {
    onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function removeRow(id: string) {
    onChange(rows.filter((r) => r.id !== id));
  }

  function addRow() {
    const nextLang = availableLangs[0]?.code ?? "";
    onChange([...rows, newLangRow(nextLang)]);
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="mb-1 block text-[12px] font-medium text-ink-navy">{label}</span>
        <button
          type="button"
          onClick={addRow}
          disabled={availableLangs.length === 0}
          className="tap flex items-center gap-1 rounded-pill border border-hairline-strong px-2 py-0.5 text-[11px] font-medium text-ink-navy transition hover:bg-mist-navy disabled:cursor-not-allowed disabled:opacity-40"
        >
          <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
            <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          Add language
        </button>
      </div>

      <div className="space-y-2">
        {rows.length === 0 && (
          <div className="rounded-card border border-dashed border-hairline-strong px-3 py-2.5 text-[12px] text-muted">
            No {label.toLowerCase()} added yet.
          </div>
        )}
        {rows.map((row) => {
          const langOpt = LANGUAGE_OPTIONS.find((o) => o.code === row.lang);
          const rowAvailable = [
            ...LANGUAGE_OPTIONS.filter((o) => o.code === row.lang),
            ...availableLangs,
          ];
          return (
            <div key={row.id} className="flex items-start gap-2">
              <select
                value={row.lang}
                onChange={(e) => updateRow(row.id, { lang: e.target.value })}
                className="w-28 shrink-0 rounded-card border border-hairline-strong bg-chalk-white px-2 py-2 text-[13px] text-ink-navy outline-none focus:border-ink-navy"
              >
                {!langOpt && <option value="">{"\u2014"}</option>}
                {rowAvailable.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.label}
                  </option>
                ))}
              </select>

              {multiline ? (
                <textarea
                  value={row.value}
                  onChange={(e) => updateRow(row.id, { value: e.target.value })}
                  placeholder={placeholder}
                  rows={2}
                  className="min-w-0 flex-1 rounded-card border border-hairline-strong bg-chalk-white px-3 py-2 text-[14px] text-ink outline-none focus:border-ink-navy"
                />
              ) : (
                <input
                  type="text"
                  value={row.value}
                  onChange={(e) => updateRow(row.id, { value: e.target.value })}
                  placeholder={placeholder}
                  className="min-w-0 flex-1 rounded-card border border-hairline-strong bg-chalk-white px-3 py-2 text-[14px] text-ink outline-none focus:border-ink-navy"
                />
              )}

              {aiAction && (
                <AiRowButton
                  busy={aiBusyLang === row.lang}
                  onClick={() => aiAction(row.lang)}
                />
              )}

              <button
                type="button"
                onClick={() => removeRow(row.id)}
                className="tap flex h-8 w-8 shrink-0 items-center justify-center rounded-card text-muted transition hover:bg-red-50 hover:text-red-600"
                aria-label="Remove"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none">
                  <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Navigation types
// ═══════════════════════════════════════════════════════════════════════════════

type View =
  | { level: "garments" }
  | { level: "garment"; garmentId: string; garmentLabel: string }
  | { level: "component"; garmentId: string; garmentLabel: string; componentId: string; componentLabel: string }
  | {
      level: "variation";
      garmentId: string;
      garmentLabel: string;
      componentId: string;
      componentLabel: string;
      variationId: string;
      variationLabel: string;
    }
  | { level: "addon"; garmentId: string; garmentLabel: string; addonId: string; addonLabel: string };

// ─── URL <-> View helpers ────────────────────────────────────────────────────

function viewFromParams(sp: URLSearchParams): View {
  const g = sp.get("g");
  const gl = sp.get("gl") ?? "";
  const c = sp.get("c");
  const cl = sp.get("cl") ?? "";
  const v = sp.get("v");
  const vl = sp.get("vl") ?? "";
  const a = sp.get("a");
  const al = sp.get("al") ?? "";

  if (v && c && g) return { level: "variation", garmentId: g, garmentLabel: gl, componentId: c, componentLabel: cl, variationId: v, variationLabel: vl };
  if (c && g) return { level: "component", garmentId: g, garmentLabel: gl, componentId: c, componentLabel: cl };
  if (a && g) return { level: "addon", garmentId: g, garmentLabel: gl, addonId: a, addonLabel: al };
  if (g) return { level: "garment", garmentId: g, garmentLabel: gl };
  return { level: "garments" };
}

function viewToParams(view: View): Record<string, string> {
  const params: Record<string, string> = {};
  if (view.level === "garments") return params;
  params.g = view.garmentId;
  params.gl = view.garmentLabel;
  if (view.level === "component" || view.level === "variation") {
    params.c = view.componentId;
    params.cl = view.componentLabel;
  }
  if (view.level === "variation") {
    params.v = view.variationId;
    params.vl = view.variationLabel;
  }
  if (view.level === "addon") {
    params.a = view.addonId;
    params.al = view.addonLabel;
  }
  return params;
}

function navigateToView(router: ReturnType<typeof useRouter>, view: View) {
  const params = viewToParams(view);
  const qs = new URLSearchParams(params).toString();
  router.push(`/admin/catalogue${qs ? `?${qs}` : ""}`, { scroll: false });
}

// What the modal is editing. Each entity has create mode and edit mode.
type EditKind =
  | "garment" | "component" | "variation" | "variationType" | "addon" | "addonVariation";

interface EditTarget {
  kind: EditKind;
  mode: "create" | "edit";
  // For edit mode, the existing row data:
  data?: Record<string, unknown>;
}

// Entity kinds that can carry measurement links (components are containers
// for variations, not measurable entities — see be measurement_constants).
const MEASURABLE_KINDS: Partial<Record<EditKind, MeasurableEntityType>> = {
  garment: "garment",
  variation: "variation",
  variationType: "variation_type",
  addon: "addon",
  addonVariation: "addon_variation",
};

// Catalogue kind → backend AI-content entity type (same naming as
// MEASURABLE_KINDS — components ARE included here since they have names).
const AI_ENTITY_KINDS: Record<EditKind, AiEntityType> = {
  garment: "garment",
  component: "component",
  variation: "variation",
  variationType: "variation_type",
  addon: "addon",
  addonVariation: "addon_variation",
};

// ─── Slug auto-generation ────────────────────────────────────────────────────
// Child entities (variation, variation-type, add-on variation) follow the
// {parent_slug}__{key} convention (border__lace, front_neck__round, …) that
// generate_catalog_images.py relies on to link generated images back to rows —
// kept exact, no suffix. Top-level entities (garment, component, add-on)
// slugify their label plus a short random suffix: duplicate titles ("Elastic"
// twice) must not collide on the auto slug, which the server 409s. Random
// suffix only when there is no label to use.

function slugifyLabel(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/['’"]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

function autoSlug(kind: EditKind, parentSlug: string | null, label: string): string {
  const key = slugifyLabel(label);
  const isChild = kind === "variation" || kind === "variationType" || kind === "addonVariation";
  if (isChild && parentSlug && key) return `${parentSlug}__${key}`;
  if (key) return `${key}_${crypto.randomUUID().replace(/-/g, "").slice(-5)}`;
  const prefix = kind === "addonVariation" ? "addonvar" : kind;
  return `${prefix}_${crypto.randomUUID().split("-")[0]}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Generic data-fetcher component
// ═══════════════════════════════════════════════════════════════════════════════

interface FetcherProps<T> {
  reloadKey: number;
  fetcher: () => Promise<T[]>;
  render: (items: T[], setItems: (items: T[]) => void) => React.ReactNode;
  emptyMessage: string;
  onAddToEmpty?: () => void;
  addLabel?: string;
  /** Rendered above both the empty state and the item list. */
  header?: React.ReactNode;
}

function useFetchedData<T>(reloadKey: number, fetcher: () => Promise<T[]>) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetcher()
      .then((data) => {
        if (!cancelled) {
          setItems(data);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);

  return { items, setItems, loading, error };
}

function Fetcher<T>({
  reloadKey,
  fetcher,
  render,
  emptyMessage,
  onAddToEmpty,
  addLabel,
  header,
}: FetcherProps<T>) {
  const { items, setItems, loading, error } = useFetchedData<T>(reloadKey, fetcher);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (items.length === 0)
    return (
      <>
        {header}
        <EmptyState message={emptyMessage} onAdd={onAddToEmpty} addLabel={addLabel} />
      </>
    );
  return (
    <>
      {header}
      {render(items, setItems)}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Generic card grid
// ═══════════════════════════════════════════════════════════════════════════════

function CardGrid<T extends { id: string; slug?: string | null; labels?: Record<string, string> | null; asset_urls?: string[] | null; descriptions?: Record<string, string> | null }>({
  items,
  onOpen,
  onEdit,
  onDelete,
  badges,
}: {
  items: T[];
  onOpen: (item: T) => void;
  onEdit: (item: T) => void;
  onDelete: (item: T) => void;
  badges?: (item: T) => { label: string; variant?: "default" | "positive" | "negative" | "accent" }[];
}) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {items.map((item) => {
        const title = getLabel(item.labels, item.slug ?? null, item.id);
        const subtitle = getDescription(item.descriptions) ?? undefined;
        return (
          <Card
            key={item.id}
            image={item.asset_urls}
            title={title}
            subtitle={subtitle}
            badges={badges ? badges(item) : []}
            onClick={() => onOpen(item)}
            onEdit={() => onEdit(item)}
            onDelete={() => onDelete(item)}
          />
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Helper: fetch all addons for a garment, then filter by component
// ═══════════════════════════════════════════════════════════════════════════════

function fetchComponentAddons(garmentId: string, componentId: string): Promise<Addon[]> {
  return fetchByParent<Addon>("garment_addons", "garment_id", garmentId).then((all) =>
    all.filter(
      (a) => Array.isArray(a.garment_style_component_ids) && a.garment_style_component_ids.includes(componentId),
    ),
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main page
// ═══════════════════════════════════════════════════════════════════════════════

function CataloguePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const view = useMemo(() => viewFromParams(new URLSearchParams(searchParams.toString())), [searchParams]);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [deleteItem, setDeleteItem] = useState<{ type: EditKind; id: string; label: string } | null>(null);
  const [matrixAddonId, setMatrixAddonId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // Bulk AI generation target — the list currently being bulk-processed.
  const [bulkTarget, setBulkTarget] = useState<{
    kind: AiEntityType;
    sectionTitle: string;
    items: BulkEntity[];
  } | null>(null);

  const triggerReload = useCallback(() => setReloadKey((k) => k + 1), []);

  // ─── Drag-and-drop reorder helper ────────────────────────────────────────
  // Fires parallel PUT requests to persist new priority_order values.
  // `entityType` is the plural URL segment (e.g. "garment_style_components").
  const reorder = useCallback(
    (entityType: string, reorderedItems: { id: string }[]) => {
      void Promise.all(
        reorderedItems.map((item, idx) =>
          updatePriorityOrder(entityType, item.id, idx + 1).catch((e) => {
            console.error(`Reorder failed for ${entityType}/${item.id}:`, e);
          }),
        ),
      );
    },
    [],
  );

  // Emit secondary sidebar items — Catalogue sub-tabs
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("admin-sidebar-update", {
        detail: {
          items: [
            {
              label: "Catalogue",
              active: true,
              onClick: () => navigateToView(router, { level: "garments" }),
            },
            {
              label: "Library",
              active: false,
              onClick: () => router.push("/admin/catalogue/library"),
            },
          ],
        },
      }),
    );
    return () => {
      window.dispatchEvent(new CustomEvent("admin-sidebar-update", { detail: null }));
    };
  }, [router]);

  // ─── Breadcrumbs ──────────────────────────────────────────────────────────

  const crumbs: Crumb[] = [{ label: "Catalogue", onClick: () => navigateToView(router, { level: "garments" }) }];

  if (view.level !== "garments") {
    crumbs.push({
      label: view.garmentLabel,
      onClick: () => navigateToView(router, { level: "garment", garmentId: view.garmentId, garmentLabel: view.garmentLabel }),
    });
  }
  if (view.level === "component" || view.level === "variation") {
    crumbs.push({
      label: view.componentLabel,
      onClick: () =>
        navigateToView(router, {
          level: "component",
          garmentId: view.garmentId,
          garmentLabel: view.garmentLabel,
          componentId: view.componentId,
          componentLabel: view.componentLabel,
        }),
    });
  }
  if (view.level === "variation") crumbs.push({ label: view.variationLabel });
  if (view.level === "addon") crumbs.push({ label: view.addonLabel });

  // ─── Delete handler ──────────────────────────────────────────────────────

  const handleDelete = async () => {
    if (!deleteItem) return;
    try {
      switch (deleteItem.type) {
        case "garment":
          await deleteGarment(deleteItem.id);
          navigateToView(router, { level: "garments" });
          break;
        case "component":
          await deleteStyleComponent(deleteItem.id);
          if (view.level === "component" || view.level === "variation") {
            navigateToView(router, { level: "garment", garmentId: view.garmentId, garmentLabel: view.garmentLabel });
          }
          break;
        case "variation":
          await deleteVariation(deleteItem.id);
          if (view.level === "variation") {
            navigateToView(router, {
              level: "component",
              garmentId: view.garmentId,
              garmentLabel: view.garmentLabel,
              componentId: view.componentId,
              componentLabel: view.componentLabel,
            });
          }
          break;
        case "variationType":
          await deleteVariationType(deleteItem.id);
          break;
        case "addon":
          await deleteAddon(deleteItem.id);
          if (view.level === "addon") {
            navigateToView(router, { level: "garment", garmentId: view.garmentId, garmentLabel: view.garmentLabel });
          }
          break;
        case "addonVariation":
          await deleteAddonVariation(deleteItem.id);
          break;
      }
      setDeleteItem(null);
      triggerReload();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════════════════════════════════

  // Determine page title and subtitle based on view level
  const pageTitle: Record<string, string> = {
    garments: "Catalogue",
    garment: view.level === "garment" ? view.garmentLabel : "",
    component: view.level === "component" ? view.componentLabel : "",
    variation: view.level === "variation" ? view.variationLabel : "",
    addon: view.level === "addon" ? view.addonLabel : "",
  };
  const pageSubtitle: Record<string, string> = {
    garments: "Browse and manage all garments, their style components, and add-ons",
    garment: "Style components and add-ons for this garment",
    component: "Variations and add-ons within this style component",
    variation: "Specific types within this variation",
    addon: "Variations within this add-on",
  };

  return (
    <div className="min-h-dvh bg-warm-sand">
      {/* ── Page header ── */}
      <div className="sticky top-0 z-20 border-b border-hairline bg-chalk-white/95 backdrop-blur-sm md:static md:z-auto md:bg-transparent md:backdrop-blur-none">
        <div className="px-5 py-4 md:px-8 md:py-6">
          <div className="mb-2">
            <Breadcrumb crumbs={crumbs} />
          </div>
          <div className="flex items-end justify-between gap-3">
            <div>
              <h1 className="font-heading text-2xl font-bold text-ink-navy md:text-[28px]">
                {pageTitle[view.level]}
              </h1>
              <p className="mt-0.5 text-[13px] text-muted">
                {pageSubtitle[view.level]}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="px-5 py-5 md:px-8 md:py-7">
        {/* ─── Level 1: Garments ─── */}
        {view.level === "garments" && (
          <Fetcher<Garment>
            reloadKey={reloadKey}
            fetcher={() => fetchAll<Garment>("garments")}
            emptyMessage="No garments yet. Create your first garment to get started."
            onAddToEmpty={() => setEditTarget({ kind: "garment", mode: "create" })}
            addLabel="Add Garment"
            render={(items) => (
              <div className="space-y-4">
                <SectionHeader
                  title="All Garments"
                  count={items.length}
                  onAdd={() => setEditTarget({ kind: "garment", mode: "create" })}
                  addLabel="Add Garment"
                  actions={<BulkGenerateButton onClick={() => setBulkTarget({ kind: "garment", sectionTitle: "Garments", items })} />}
                />
                <CardGrid
                  items={items}
                  onOpen={(g) => navigateToView(router, { level: "garment", garmentId: g.id, garmentLabel: getLabel(g.labels, g.slug, g.id) })}
                  onEdit={(g) => setEditTarget({ kind: "garment", mode: "edit", data: g as unknown as Record<string, unknown> })}
                  onDelete={(g) => setDeleteItem({ type: "garment", id: g.id, label: getLabel(g.labels, g.slug, g.id) })}
                  badges={(g) => {
                    const b: { label: string; variant?: "default" | "positive" | "negative" | "accent" }[] = [];
                    if (g.gender) b.push({ label: g.gender, variant: "accent" });
                    if (g.base_price != null) b.push({ label: `\u20B9${g.base_price}`, variant: "positive" });
                    return b;
                  }}
                />
              </div>
            )}
          />
        )}

        {/* ─── Level 2: Garment detail (Components + Addons) ─── */}
        {view.level === "garment" && (
          <div className="space-y-10">
            {/* Style Components */}
            <Fetcher<StyleComponent>
              reloadKey={reloadKey}
              fetcher={() => fetchByParent<StyleComponent>("garment_style_component", "garment_id", view.garmentId)}
              emptyMessage="No style components yet."
              onAddToEmpty={() => setEditTarget({ kind: "component", mode: "create" })}
              addLabel="Add Component"
              render={(items, setItems) => (
                <div className="space-y-4">
                  <SectionHeader
                    title="Style Components"
                    count={items.length}
                    onAdd={() => setEditTarget({ kind: "component", mode: "create" })}
                    addLabel="Add Component"
                    actions={<BulkGenerateButton onClick={() => setBulkTarget({ kind: "component", sectionTitle: "Style Components", items })} />}
                  />
                  <ReorderableCardGrid
                    items={items}
                    onOpen={(c) =>
                      navigateToView(router, {
                        level: "component",
                        garmentId: view.garmentId,
                        garmentLabel: view.garmentLabel,
                        componentId: c.id,
                        componentLabel: getLabel(c.labels, c.slug, c.id),
                      })
                    }
                    onEdit={(c) => setEditTarget({ kind: "component", mode: "edit", data: c as unknown as Record<string, unknown> })}
                    onDelete={(c) => setDeleteItem({ type: "component", id: c.id, label: getLabel(c.labels, c.slug, c.id) })}
                    badges={(c) => {
                      const b: { label: string; variant?: "default" | "positive" | "negative" | "accent" }[] = [];
                      if (c.importance) b.push({ label: c.importance, variant: "accent" });
                      return b;
                    }}
                    onReorder={(reordered) => {
                      setItems(reordered);
                      reorder("garment_style_components", reordered);
                    }}
                  />
                </div>
              )}
            />

            {/* Divider */}
            <div className="border-t border-hairline" />

            {/* Addons */}
            <Fetcher<Addon>
              reloadKey={reloadKey}
              fetcher={() => fetchByParent<Addon>("garment_addons", "garment_id", view.garmentId)}
              emptyMessage="No add-ons yet."
              onAddToEmpty={() => setEditTarget({ kind: "addon", mode: "create" })}
              addLabel="Add Add-on"
              render={(items, setItems) => (
                <div className="space-y-4">
                  <SectionHeader
                    title="Add-ons"
                    count={items.length}
                    onAdd={() => setEditTarget({ kind: "addon", mode: "create" })}
                    addLabel="Add Add-on"
                    actions={<BulkGenerateButton onClick={() => setBulkTarget({ kind: "addon", sectionTitle: "Add-ons", items })} />}
                  />
                  <ReorderableCardGrid
                    items={items}
                    onOpen={(a) =>
                      navigateToView(router, {
                        level: "addon",
                        garmentId: view.garmentId,
                        garmentLabel: view.garmentLabel,
                        addonId: a.id,
                        addonLabel: getLabel(a.labels, a.slug, a.id),
                      })
                    }
                    onEdit={(a) => setEditTarget({ kind: "addon", mode: "edit", data: a as unknown as Record<string, unknown> })}
                    onDelete={(a) => setDeleteItem({ type: "addon", id: a.id, label: getLabel(a.labels, a.slug, a.id) })}
                    badges={(a) => {
                      const b: { label: string; variant?: "default" | "positive" | "negative" | "accent" }[] = [];
                      if (a.type) b.push({ label: a.type, variant: "accent" });
                      if (a.price != null) b.push({ label: `+\u20B9${a.price}`, variant: "positive" });
                      if (a.is_default_on) b.push({ label: "Default", variant: "positive" });
                      return b;
                    }}
                    onReorder={(reordered) => {
                      setItems(reordered);
                      reorder("garment_addons", reordered);
                    }}
                  />
                </div>
              )}
            />
          </div>
        )}

        {/* ─── Level 3: Component detail → Variations + Component Addons ─── */}
        {view.level === "component" && (
          <div className="space-y-10">
            {/* Variations */}
            <Fetcher<Variation>
              reloadKey={reloadKey}
              fetcher={() => fetchByParent<Variation>("garment_style_component_variations", "component_id", view.componentId)}
              emptyMessage="No variations yet."
              onAddToEmpty={() => setEditTarget({ kind: "variation", mode: "create" })}
              addLabel="Add Variation"
              render={(items, setItems) => (
                <div className="space-y-4">
                  <SectionHeader
                    title="Variations"
                    count={items.length}
                    onAdd={() => setEditTarget({ kind: "variation", mode: "create" })}
                    addLabel="Add Variation"
                    actions={<BulkGenerateButton onClick={() => setBulkTarget({ kind: "variation", sectionTitle: "Variations", items })} />}
                  />
                  <ReorderableCardGrid
                    items={items}
                    onOpen={(v) =>
                      navigateToView(router, {
                        level: "variation",
                        garmentId: view.garmentId,
                        garmentLabel: view.garmentLabel,
                        componentId: view.componentId,
                        componentLabel: view.componentLabel,
                        variationId: v.id,
                        variationLabel: getLabel(v.labels, v.slug, v.id),
                      })
                    }
                    onEdit={(v) => setEditTarget({ kind: "variation", mode: "edit", data: v as unknown as Record<string, unknown> })}
                    onDelete={(v) => setDeleteItem({ type: "variation", id: v.id, label: getLabel(v.labels, v.slug, v.id) })}
                    badges={(v) => {
                      const b: { label: string; variant?: "default" | "positive" | "negative" | "accent" }[] = [];
                      if (v.price != null) b.push({ label: `\u20B9${v.price}`, variant: "positive" });
                      return b;
                    }}
                    onReorder={(reordered) => {
                      setItems(reordered);
                      reorder("garment_style_component_variations", reordered);
                    }}
                  />
                </div>
              )}
            />

            {/* Divider */}
            <div className="border-t border-hairline" />

            {/* Component-level Addons (read-only display — addons are managed in the addons section, not here) */}
            <Fetcher<Addon>
              reloadKey={reloadKey}
              fetcher={() => fetchComponentAddons(view.garmentId, view.componentId)}
              emptyMessage="No add-ons are linked to this style component. Add-ons are created in the Add-ons section below the garment."
              render={(items) => (
                <div className="space-y-4">
                  <SectionHeader title="Linked Add-ons" count={items.length} />
                  <CardGrid
                    items={items}
                    onOpen={(a) =>
                      navigateToView(router, {
                        level: "addon",
                        garmentId: view.garmentId,
                        garmentLabel: view.garmentLabel,
                        addonId: a.id,
                        addonLabel: getLabel(a.labels, a.slug, a.id),
                      })
                    }
                    onEdit={(a) => setEditTarget({ kind: "addon", mode: "edit", data: a as unknown as Record<string, unknown> })}
                    onDelete={(a) => setDeleteItem({ type: "addon", id: a.id, label: getLabel(a.labels, a.slug, a.id) })}
                    badges={(a) => {
                      const b: { label: string; variant?: "default" | "positive" | "negative" | "accent" }[] = [];
                      if (a.type) b.push({ label: a.type, variant: "accent" });
                      if (a.price != null) b.push({ label: `+\u20B9${a.price}`, variant: "positive" });
                      if (a.is_default_on) b.push({ label: "Default", variant: "positive" });
                      return b;
                    }}
                  />
                </div>
              )}
            />
          </div>
        )}

        {/* ─── Level 4: Variation detail → Variation Types ─── */}
        {view.level === "variation" && (
          <Fetcher<VariationType>
            reloadKey={reloadKey}
            fetcher={() => fetchByParent<VariationType>("garment_style_component_variation_types", "variation_id", view.variationId)}
            emptyMessage="No variation types yet."
            onAddToEmpty={() => setEditTarget({ kind: "variationType", mode: "create" })}
            addLabel="Add Type"
            render={(items, setItems) => (
              <div className="space-y-4">
                <SectionHeader
                  title="Variation Types"
                  count={items.length}
                  onAdd={() => setEditTarget({ kind: "variationType", mode: "create" })}
                  addLabel="Add Type"
                  actions={<BulkGenerateButton onClick={() => setBulkTarget({ kind: "variation_type", sectionTitle: "Variation Types", items })} />}
                />
                <ReorderableCardGrid
                  items={items}
                  onOpen={() => { /* leaf — no drill-down */ }}
                  onEdit={(t) => setEditTarget({ kind: "variationType", mode: "edit", data: t as unknown as Record<string, unknown> })}
                  onDelete={(t) => setDeleteItem({ type: "variationType", id: t.id, label: getLabel(t.labels, t.slug, t.id) })}
                  badges={(t) => {
                    const b: { label: string; variant?: "default" | "positive" | "negative" | "accent" }[] = [];
                    if (t.price != null) b.push({ label: `\u20B9${t.price}`, variant: "positive" });
                    return b;
                  }}
                  onReorder={(reordered) => {
                    setItems(reordered);
                    reorder("garment_style_component_variation_types", reordered);
                  }}
                />
              </div>
            )}
          />
        )}

        {/* ─── Level 3b: Addon detail → Addon Variations ─── */}
        {view.level === "addon" && (
          <Fetcher<AddonVariation>
            reloadKey={reloadKey}
            fetcher={() => fetchByParent<AddonVariation>("garment_addon_variations", "addon_id", view.addonId)}
            emptyMessage="No add-on variations yet."
            onAddToEmpty={() => setEditTarget({ kind: "addonVariation", mode: "create" })}
            addLabel="Add Variation"
            header={
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-card border border-hairline bg-mist-navy/40 px-4 py-3">
                <div>
                  <div className="text-[13px] font-semibold text-ink-navy">Price matrix</div>
                  <div className="text-[12px] text-muted">
                    Price each option combination (e.g. shape × size — one price per cell) instead of one row at a time.
                  </div>
                </div>
                <button
                  onClick={() => setMatrixAddonId(view.addonId)}
                  className="tap inline-flex items-center gap-1.5 rounded-pill bg-ink-navy px-3.5 py-1.5 text-[13px] font-medium text-chalk-white transition hover:bg-ink-navy/90 active:scale-95"
                >
                  <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none">
                    <path d="M2 13h12M4 10V6M8 10V3M12 10V8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                  Open matrix editor
                </button>
              </div>
            }
            render={(items, setItems) => (
              <div className="space-y-4">
                <SectionHeader
                  title="Add-on Variations"
                  count={items.length}
                  onAdd={() => setEditTarget({ kind: "addonVariation", mode: "create" })}
                  addLabel="Add Variation"
                  actions={<BulkGenerateButton onClick={() => setBulkTarget({ kind: "addon_variation", sectionTitle: "Add-on Variations", items })} />}
                />
                <ReorderableCardGrid
                  items={items}
                  onOpen={() => { /* leaf */ }}
                  onEdit={(v) => setEditTarget({ kind: "addonVariation", mode: "edit", data: v as unknown as Record<string, unknown> })}
                  onDelete={(v) => setDeleteItem({ type: "addonVariation", id: v.id, label: getLabel(v.labels, v.slug, v.id) })}
                  badges={(v) => {
                    const b: { label: string; variant?: "default" | "positive" | "negative" | "accent" }[] = [];
                    // The name already spells out the full combination — badges
                    // repeat the scannable differentiators (color/size/placement).
                    if (v.color) b.push({ label: v.color });
                    if (v.size) b.push({ label: v.size });
                    if (v.placement) b.push({ label: `@ ${v.placement}`, variant: "accent" });
                    if (v.price != null) b.push({ label: `\u20B9${v.price}`, variant: "positive" });
                    return b;
                  }}
                  onReorder={(reordered) => {
                    setItems(reordered);
                    reorder("garment_addon_variations", reordered);
                  }}
                />
              </div>
            )}
          />
        )}
      </div>

      {/* Price-matrix editor */}
      {view.level === "addon" && matrixAddonId && (
        <AddonMatrixModal
          addonId={matrixAddonId}
          onClose={() => setMatrixAddonId(null)}
          onSaved={() => {
            setMatrixAddonId(null);
            triggerReload();
          }}
        />
      )}

      {/* Bulk AI generation */}
      {bulkTarget && (
        <BulkGenerateModal
          kind={bulkTarget.kind}
          sectionTitle={bulkTarget.sectionTitle}
          items={bulkTarget.items}
          onClose={() => setBulkTarget(null)}
          onSaved={() => {
            setBulkTarget(null);
            triggerReload();
          }}
        />
      )}

      {/* Modal form */}
      {editTarget && (
        <CatalogueFormModal
          target={editTarget}
          view={view}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            setEditTarget(null);
            triggerReload();
          }}
        />
      )}

      {/* Delete confirmation */}
      <ConfirmDelete
        open={deleteItem !== null}
        title="Confirm delete"
        message={deleteItem ? `Delete "${deleteItem.label}"? This cannot be undone.` : ""}
        onConfirm={handleDelete}
        onCancel={() => setDeleteItem(null)}
      />
    </div>
  );
}

export default function CataloguePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center bg-warm-sand">
          <span className="text-caption text-muted">Loading...</span>
        </div>
      }
    >
      <CataloguePageInner />
    </Suspense>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// CatalogueFormModal — self-contained modal form with its own state
// ═══════════════════════════════════════════════════════════════════════════════

function CatalogueFormModal({
  target,
  view,
  onClose,
  onSaved,
}: {
  target: EditTarget;
  view: View;
  onClose: () => void;
  onSaved: () => void;
}) {
  // Derive initial values from target.data for edit, defaults for create.
  const d = target.data as Record<string, unknown> | undefined;

  // ── Multi-language labels/descriptions ──
  const [labelRows, setLabelRows] = useState<LangRow[]>(() => {
    const rows = dictToLangRows((d?.labels as Record<string, string> | null) ?? null);
    if (!rows.some((r) => r.lang === "en")) rows.unshift(newLangRow("en"));
    return rows;
  });
  const [descRows, setDescRows] = useState<LangRow[]>(() =>
    dictToLangRows((d?.descriptions as Record<string, string> | null) ?? null),
  );

  // ── Common fields ──
  const [slug, setSlug] = useState<string>((d?.slug as string) ?? "");
  const [assetUrlsList, setAssetUrlsList] = useState<string[]>(
    () => (Array.isArray(d?.asset_urls) ? (d!.asset_urls as string[]) : []),
  );
  const [price, setPrice] = useState<string>(
    d?.price != null ? String(d!.price) : (d?.base_price != null ? String(d!.base_price) : "")
  );
  const [priority, setPriority] = useState<string>(
    d?.priority_order != null ? String(d!.priority_order) : ""
  );

  // ── Entity-specific fields ──
  const [gender, setGender] = useState<string>((d?.gender as string) ?? "");
  const [importance, setImportance] = useState<string>((d?.importance as string) ?? "");
  const [type, setType] = useState<string>((d?.type as string) ?? "");
  const [isDefaultOn, setIsDefaultOn] = useState<boolean>((d?.is_default_on as boolean) ?? false);
  const [placementsList, setPlacementsList] = useState<string[]>(
    () => (Array.isArray(d?.placements) ? (d!.placements as string[]) : []),
  );
  const [customPlacement, setCustomPlacement] = useState("");
  // Selected component IDs for addon form (replaces raw text input)
  const [selectedComponentIds, setSelectedComponentIds] = useState<Set<string>>(() => {
    const arr = Array.isArray(d?.garment_style_component_ids) ? (d!.garment_style_component_ids as string[]) : [];
    return new Set(arr);
  });
  // Available style components for this garment (fetched for the addon form)
  const [availableComponents, setAvailableComponents] = useState<StyleComponent[]>([]);
  const [componentsLoading, setComponentsLoading] = useState(false);

  // ── Default child pickers ──
  // Style Component → default variation
  const [defaultVariationId, setDefaultVariationId] = useState<string>(
    (d?.default_variation_id as string) ?? "",
  );
  const [componentVariations, setComponentVariations] = useState<Variation[]>([]);
  // Variation → default variation-type
  const [defaultTypeId, setDefaultTypeId] = useState<string>((d?.default_type_id as string) ?? "");
  const [variationTypes, setVariationTypes] = useState<VariationType[]>([]);
  // Addon → default addon variation
  const [defaultAddonVariationId, setDefaultAddonVariationId] = useState<string>(
    (d?.default_variation_id as string) ?? "",
  );
  const [addonVariations, setAddonVariations] = useState<AddonVariation[]>([]);
  const [defaultChildrenLoading, setDefaultChildrenLoading] = useState(false);
  const [style, setStyle] = useState<string>((d?.style as string) ?? "");
  const [shape, setShape] = useState<string>((d?.shape as string) ?? "");
  const [size, setSize] = useState<string>((d?.size as string) ?? "");
  const [color, setColor] = useState<string>((d?.color as string) ?? "");
  // Addon-variation placement axis — vocabulary comes from the parent add-on.
  const [placement, setPlacement] = useState<string>((d?.placement as string) ?? "");
  const [parentAddonPlacements, setParentAddonPlacements] = useState<string[]>([]);
  // Explicitly switched to free-text placement entry (via the "Custom…" option).
  const [customPlacementMode, setCustomPlacementMode] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── AI content (description + image) ──
  const aiDesc = useAiDescription();
  const aiImage = useAiImage();
  // Saved rows resolve their full parent chain server-side via entity_id;
  // unsaved rows need the parent the form is opened under (view carries it).
  let aiParentId: string | null = null;
  if (target.mode === "create") {
    if (target.kind === "component" || target.kind === "addon") {
      aiParentId = view.level !== "garments" ? view.garmentId : null;
    } else if (target.kind === "variation") {
      aiParentId = view.level === "component" || view.level === "variation" ? view.componentId : null;
    } else if (target.kind === "variationType") {
      aiParentId = view.level === "variation" ? view.variationId : null;
    } else if (target.kind === "addonVariation") {
      aiParentId = view.level === "addon" ? view.addonId : null;
    }
  }
  const aiContext: AiEntityContext = {
    entityType: AI_ENTITY_KINDS[target.kind],
    entityId: target.mode === "edit" ? ((d?.id as string) ?? null) : null,
    parentId: aiParentId,
  };
  const aiActionForLang = (lang: string) =>
    aiDesc.generateForLang({
      context: aiContext,
      lang,
      labelRows,
      descRows,
      setLabelRows,
      setDescRows,
    });
  // Generate a new AI image. replaceUrl set → regenerate IN PLACE of that
  // image; null → prepend a new one. Either way the list is local form
  // state — nothing is written to the entity until Save is pressed.
  const handleGenerateImage = async (replaceUrl: string | null) => {
    const url = await aiImage.generate({ context: aiContext, labelRows, descRows });
    if (!url) return;
    setAssetUrlsList((prev) =>
      replaceUrl != null ? prev.map((u) => (u === replaceUrl ? url : u)) : [url, ...prev],
    );
  };

  // ── Helpers ──
  const labels = langRowsToDict(labelRows);
  const descriptions = langRowsToDict(descRows);
  // Best label for slug derivation: English, else first non-empty.
  const primaryLabel =
    (labels?.en || Object.values(labels ?? {}).find((v) => v?.trim()) || "") as string;
  const assetUrls = assetUrlsList.length > 0 ? assetUrlsList : null;
  const priceNum = price.trim() ? Number(price) : null;
  const priorityNum = priority.trim() ? Number(priority) : null;
  // Placements vocabulary = exactly what the admin added (custom text, or a
  // component picked in the matrix editor). Linked component labels are NOT
  // auto-added — every chip is removable.
  const customPlacements = placementsList;
  const togglePlacement = (value: string) =>
    setPlacementsList((prev) =>
      prev.includes(value) ? prev.filter((p) => p !== value) : [...prev, value],
    );
  const addCustomPlacement = () => {
    const value = customPlacement.trim();
    if (!value) return;
    setPlacementsList((prev) => (prev.includes(value) ? prev : [...prev, value]));
    setCustomPlacement("");
  };

  // Addon-variation placement vocabulary: parent add-on's placements ∪ the
  // garment's component labels (kept so rows carrying a component-label
  // placement from before the union removal stay pickable), deduped, parent
  // placements first.
  const placementOptions: string[] = [];
  {
    const seen = new Set<string>();
    const componentLabels = availableComponents.map((c) =>
      getLabel(c.labels, c.slug, c.id),
    );
    for (const p of [...parentAddonPlacements, ...componentLabels]) {
      if (p && !seen.has(p)) {
        seen.add(p);
        placementOptions.push(p);
      }
    }
  }
  // Free-text entry when explicitly chosen, or when the current value isn't
  // in the vocabulary (legacy/custom placements stay editable, not reset).
  const showCustomPlacementInput =
    customPlacementMode ||
    (placement !== "" && !placementOptions.includes(placement));

  // ── For addon creation inside a component view, auto-link the component ──
  // If we're creating an addon while viewing a component, pre-fill the component id
  const isAddonInComponentView = target.kind === "addon" && view.level === "component";

  // ── Parent slug, for auto-generating child slugs as {parent_slug}__{key} ──
  const [parentSlug, setParentSlug] = useState<string | null>(null);

  useEffect(() => {
    const isChildKind =
      target.kind === "variation" || target.kind === "variationType" || target.kind === "addonVariation";
    if (!isChildKind || target.mode !== "create") {
      setParentSlug(null);
      return;
    }

    let table: string | null = null;
    let parentId: string | null = null;
    if (target.kind === "variation" && (view.level === "component" || view.level === "variation")) {
      table = "garment_style_component";
      parentId = view.componentId;
    } else if (target.kind === "variationType" && view.level === "variation") {
      table = "garment_style_component_variations";
      parentId = view.variationId;
    } else if (target.kind === "addonVariation" && view.level === "addon") {
      table = "garment_addons";
      parentId = view.addonId;
    }
    if (!table || !parentId) {
      setParentSlug(null);
      return;
    }

    let cancelled = false;
    fetchByParent<{ slug?: string }>(table, "id", parentId, 1)
      .then((rows) => {
        if (!cancelled) setParentSlug(rows[0]?.slug ?? null);
      })
      .catch(() => {
        if (!cancelled) setParentSlug(null);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.kind, target.mode, view]);

  // ── Fetch available style components when addon / addon-variation form is open ──
  useEffect(() => {
    if (target.kind !== "addon" && target.kind !== "addonVariation") return;
    const garmentId = view.level !== "garments" ? view.garmentId : null;
    if (!garmentId) return;
    setComponentsLoading(true);
    fetchByParent<StyleComponent>("garment_style_component", "garment_id", garmentId)
      .then((components) => setAvailableComponents(components))
      .catch(() => setAvailableComponents([]))
      .finally(() => setComponentsLoading(false));
  }, [target.kind, view]);

  // ── Fetch the parent add-on's placements (addonVariation form vocabulary) ──
  useEffect(() => {
    if (target.kind !== "addonVariation" || view.level !== "addon") {
      setParentAddonPlacements([]);
      return;
    }
    let cancelled = false;
    fetchByParent<{ placements?: string[] | null }>("garment_addons", "id", view.addonId, 1)
      .then((rows) => {
        if (!cancelled) setParentAddonPlacements((rows[0]?.placements as string[]) ?? []);
      })
      .catch(() => {
        if (!cancelled) setParentAddonPlacements([]);
      });
    return () => {
      cancelled = true;
    };
  }, [target.kind, view]);

  // ── Fetch candidate children for the "default" pickers (edit mode only) ──
  // For Style Component → its variations; Variation → its types; Addon → its variations.
  useEffect(() => {
    if (target.mode !== "edit") return;
    setDefaultChildrenLoading(true);

    if (target.kind === "component") {
      const componentId = d?.id as string | undefined;
      if (!componentId) { setDefaultChildrenLoading(false); return; }
      fetchByParent<Variation>("garment_style_component_variations", "component_id", componentId)
        .then(setComponentVariations)
        .catch(() => setComponentVariations([]))
        .finally(() => setDefaultChildrenLoading(false));
    } else if (target.kind === "variation") {
      const variationId = d?.id as string | undefined;
      if (!variationId) { setDefaultChildrenLoading(false); return; }
      fetchByParent<VariationType>("garment_style_component_variation_types", "variation_id", variationId)
        .then(setVariationTypes)
        .catch(() => setVariationTypes([]))
        .finally(() => setDefaultChildrenLoading(false));
    } else if (target.kind === "addon") {
      const addonId = d?.id as string | undefined;
      if (!addonId) { setDefaultChildrenLoading(false); return; }
      fetchByParent<AddonVariation>("garment_addon_variations", "addon_id", addonId)
        .then(setAddonVariations)
        .catch(() => setAddonVariations([]))
        .finally(() => setDefaultChildrenLoading(false));
    } else {
      setDefaultChildrenLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.kind, target.mode]);

  // When switching targets, clear the default-child lists so stale options
  // from a previous entity don't leak into the new form.
  useEffect(() => {
    setComponentVariations([]);
    setVariationTypes([]);
    setAddonVariations([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.kind, target.mode]);

  // Modal title
  const titleMap: Record<EditKind, string> = {
    garment: target.mode === "create" ? "Add Garment" : "Edit Garment",
    component: target.mode === "create" ? "Add Style Component" : "Edit Style Component",
    variation: target.mode === "create" ? "Add Variation" : "Edit Variation",
    variationType: target.mode === "create" ? "Add Variation Type" : "Edit Variation Type",
    addon: target.mode === "create" ? "Add Add-on" : "Edit Add-on",
    addonVariation: target.mode === "create" ? "Add Add-on Variation" : "Edit Add-on Variation",
  };

  // ─── Submit ──────────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    setSaving(true);
    setError(null);
    try {
      switch (target.kind) {
        // ── Garment ──
        case "garment": {
          if (target.mode === "create") {
            await createGarment({
              slug: slug.trim() || autoSlug("garment", null, primaryLabel),
              labels,
              descriptions,
              asset_urls: assetUrls,
              gender: gender.trim() || null,
              base_price: priceNum,
            });
          } else {
            const id = d!.id as string;
            await updateGarment(id, {
              slug: slug.trim(),
              labels,
              descriptions,
              asset_urls: assetUrls,
              gender: gender.trim() || null,
              base_price: priceNum,
            } as GarmentUpdateInput);
          }
          break;
        }
        // ── Style Component ──
        case "component": {
          const garmentId = view.level !== "garments" ? view.garmentId : null;
          if (target.mode === "create") {
            await createStyleComponent({
              slug: slug.trim() || autoSlug("component", null, primaryLabel),
              garment_id: garmentId,
              labels,
              descriptions,
              asset_urls: assetUrls,
              importance: importance.trim() || null,
              priority_order: priorityNum,
              default_variation_id: defaultVariationId || null,
            });
          } else {
            const id = d!.id as string;
            await updateStyleComponent(id, {
              slug: slug.trim(),
              labels,
              descriptions,
              asset_urls: assetUrls,
              importance: importance.trim() || null,
              priority_order: priorityNum,
              default_variation_id: defaultVariationId || null,
            } as StyleComponentUpdateInput);
          }
          break;
        }
        // ── Variation ──
        case "variation": {
          const componentId = view.level === "component" || view.level === "variation" ? view.componentId : null;
          if (target.mode === "create") {
            await createVariation({
              slug: slug.trim() || autoSlug("variation", parentSlug, primaryLabel),
              component_id: componentId,
              labels,
              descriptions,
              asset_urls: assetUrls,
              price: priceNum,
              priority_order: priorityNum,
              default_type_id: defaultTypeId || null,
            });
          } else {
            const id = d!.id as string;
            await updateVariation(id, {
              slug: slug.trim(),
              labels,
              descriptions,
              asset_urls: assetUrls,
              price: priceNum,
              priority_order: priorityNum,
              default_type_id: defaultTypeId || null,
            } as VariationUpdateInput);
          }
          break;
        }
        // ── Variation Type ──
        case "variationType": {
          const variationId = view.level === "variation" ? view.variationId : null;
          if (target.mode === "create") {
            await createVariationType({
              slug: slug.trim() || autoSlug("variationType", parentSlug, primaryLabel),
              variation_id: variationId,
              labels,
              descriptions,
              asset_urls: assetUrls,
              price: priceNum,
              priority_order: priorityNum,
            });
          } else {
            const id = d!.id as string;
            await updateVariationType(id, {
              slug: slug.trim(),
              labels,
              descriptions,
              asset_urls: assetUrls,
              price: priceNum,
              priority_order: priorityNum,
            } as VariationTypeUpdateInput);
          }
          break;
        }
        // ── Addon ──
        case "addon": {
          const garmentId = view.level !== "garments" ? view.garmentId : null;
          // Build final selected component IDs from checkbox state
          const finalSelected = new Set(selectedComponentIds);
          // If creating from component view, ensure this component is included
          if (target.mode === "create" && isAddonInComponentView) {
            finalSelected.add(view.componentId);
          }
          const finalGscIds = Array.from(finalSelected);

          // Placements are exactly what the admin entered — linking a style
          // component no longer injects its label into the vocabulary.
          const effectivePlacements = placementsList;

          const payload: AddonCreateInput = {
            slug: slug.trim() || autoSlug("addon", null, primaryLabel),
            garment_id: garmentId,
            labels,
            descriptions,
            asset_urls: assetUrls,
            garment_style_component_ids: finalGscIds.length > 0 ? finalGscIds : null,
            type: type.trim() || null,
            placements: effectivePlacements.length > 0 ? effectivePlacements : null,
            price: priceNum,
            is_default_on: isDefaultOn,
            default_variation_id: defaultAddonVariationId || null,
            priority_order: priorityNum,
          };

          if (target.mode === "create") {
            await createAddon(payload);
          } else {
            const id = d!.id as string;
            await updateAddon(id, payload as AddonUpdateInput);
          }
          break;
        }
        // ── Addon Variation ──
        case "addonVariation": {
          const addonId = view.level === "addon" ? view.addonId : null;
          if (target.mode === "create") {
            await createAddonVariation({
              slug: slug.trim() || autoSlug("addonVariation", parentSlug, primaryLabel),
              addon_id: addonId,
              labels,
              descriptions,
              asset_urls: assetUrls,
              style: style.trim() || null,
              shape: shape.trim() || null,
              size: size.trim() || null,
              type: type.trim() || null,
              color: color.trim() || null,
              placement: placement || null,
              price: priceNum,
              priority_order: priorityNum,
            });
          } else {
            const id = d!.id as string;
            await updateAddonVariation(id, {
              slug: slug.trim(),
              labels,
              descriptions,
              asset_urls: assetUrls,
              style: style.trim() || null,
              shape: shape.trim() || null,
              size: size.trim() || null,
              type: type.trim() || null,
              color: color.trim() || null,
              placement: placement || null,
              price: priceNum,
              priority_order: priorityNum,
            } as AddonVariationUpdateInput);
          }
          break;
        }
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  // ─── Render fields by entity ──────────────────────────────────────────────

  return (
    <Modal open={true} title={titleMap[target.kind]} onClose={onClose} maxWidth="max-w-xl">
      <div className="space-y-4">
        {/* Labels (multi-language) */}
        <LangRowEditor
          rows={labelRows}
          onChange={setLabelRows}
          label="Labels *"
          placeholder="e.g. Classic Shirt"
          aiAction={aiActionForLang}
          aiBusyLang={aiDesc.busyLang}
        />

        {/* Slug */}
        <Field label="Slug" hint="URL-safe identifier (leave empty for auto-generated)">
          <TextInput value={slug} onChange={setSlug} placeholder="auto-generated" />
        </Field>

        {/* Descriptions (multi-language) */}
        <div>
          <LangRowEditor
            rows={descRows}
            onChange={setDescRows}
            label="Descriptions"
            multiline
            placeholder="Short description..."
            aiAction={aiActionForLang}
            aiBusyLang={aiDesc.busyLang}
          />
          <AiErrorNote error={aiDesc.error} />
        </div>

        {/* Asset images — rendered, edited locally, saved only on Save */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="block text-[12px] font-medium text-ink-navy">Asset Images</span>
            <span className="text-[10px] text-muted">changes apply on save</span>
          </div>
          <AssetImageGrid
            urls={assetUrlsList}
            busy={aiImage.loading}
            onRemove={(url) => setAssetUrlsList((prev) => prev.filter((u) => u !== url))}
            onRegenerate={(url) => {
              void handleGenerateImage(url);
            }}
          />
          <AddAssetUrlInput
            onAdd={(url) =>
              setAssetUrlsList((prev) => (prev.includes(url) ? prev : [...prev, url]))
            }
          />
          <AiImagePanel
            loading={aiImage.loading}
            error={aiImage.error}
            lastPrompt={aiImage.lastPrompt}
            onGenerate={() => {
              void handleGenerateImage(null);
            }}
          />
        </div>

        {/* Garment-specific */}
        {target.kind === "garment" && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Gender">
              <Select
                value={gender}
                onChange={setGender}
                options={[
                  { value: "male", label: "Male" },
                  { value: "female", label: "Female" },
                  { value: "unisex", label: "Unisex" },
                ]}
              />
            </Field>
            <Field label="Base Price (\u20B9)">
              <TextInput value={price} onChange={setPrice} type="number" placeholder="0" />
            </Field>
          </div>
        )}

        {/* Component-specific */}
        {target.kind === "component" && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Importance">
              <Select
                value={importance}
                onChange={setImportance}
                options={[
                  { value: "critical", label: "Critical" },
                  { value: "non_critical", label: "Non-Critical" },
                ]}
              />
            </Field>
            <Field label="Priority Order">
              <TextInput value={priority} onChange={setPriority} type="number" placeholder="0" />
            </Field>
          </div>
        )}

        {/* Style Component \u2192 Default Variation picker */}
        {target.kind === "component" && (
          <Field label="Default Variation" hint="Pre-selected variation for this component">
            {target.mode === "edit" ? (
              defaultChildrenLoading ? (
                <div className="py-2 text-[13px] text-muted">Loading variations\u2026</div>
              ) : componentVariations.length === 0 ? (
                <div className="rounded-card border border-dashed border-hairline-strong px-3 py-2.5 text-[12px] text-muted">
                  No variations yet. Add variations first, then set a default.
                </div>
              ) : (
                <Select
                  value={defaultVariationId}
                  onChange={setDefaultVariationId}
                  placeholder="None"
                  options={componentVariations.map((v) => ({
                    value: v.id,
                    label: getLabel(v.labels, v.slug, v.id),
                  }))}
                />
              )
            ) : (
              <div className="rounded-card border border-dashed border-hairline-strong px-3 py-2.5 text-[12px] text-muted">
                Save the component first, then add variations to choose a default.
              </div>
            )}
          </Field>
        )}

        {/* Variation / VariationType: price + priority */}
        {(target.kind === "variation" || target.kind === "variationType") && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Price (\u20B9)">
              <TextInput value={price} onChange={setPrice} type="number" placeholder="0" />
            </Field>
            <Field label="Priority Order">
              <TextInput value={priority} onChange={setPriority} type="number" placeholder="0" />
            </Field>
          </div>
        )}

        {/* Variation \u2192 Default Variation Type picker */}
        {target.kind === "variation" && (
          <Field label="Default Variation Type" hint="Pre-selected variation type for this variation">
            {target.mode === "edit" ? (
              defaultChildrenLoading ? (
                <div className="py-2 text-[13px] text-muted">Loading variation types\u2026</div>
              ) : variationTypes.length === 0 ? (
                <div className="rounded-card border border-dashed border-hairline-strong px-3 py-2.5 text-[12px] text-muted">
                  No variation types yet. Add types first, then set a default.
                </div>
              ) : (
                <Select
                  value={defaultTypeId}
                  onChange={setDefaultTypeId}
                  placeholder="None"
                  options={variationTypes.map((t) => ({
                    value: t.id,
                    label: getLabel(t.labels, t.slug, t.id),
                  }))}
                />
              )
            ) : (
              <div className="rounded-card border border-dashed border-hairline-strong px-3 py-2.5 text-[12px] text-muted">
                Save the variation first, then add variation types to choose a default.
              </div>
            )}
          </Field>
        )}

        {/* Addon-specific */}
        {target.kind === "addon" && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Type">
                <Select
                  value={type}
                  onChange={setType}
                  options={[
                    { value: "style", label: "Style" },
                    { value: "material", label: "Material" },
                  ]}
                />
              </Field>
              <Field label="Price (\u20B9)" hint="Only when no variations">
                <TextInput value={price} onChange={setPrice} type="number" placeholder="0" />
              </Field>
              <Field label="Priority Order">
                <TextInput value={priority} onChange={setPriority} type="number" placeholder="0" />
              </Field>
              <Field label="Default On?">
                <label className="flex h-[38px] items-center gap-2">
                  <input
                    type="checkbox"
                    checked={isDefaultOn}
                    onChange={(e) => setIsDefaultOn(e.target.checked)}
                    className="h-4 w-4"
                  />
                  <span className="text-[13px] text-ink-navy">Enabled by default</span>
                </label>
              </Field>
            </div>

            <Field label="Placements" hint="Where this add-on can be applied — every chip is removable">
              <div className="flex flex-col gap-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  {customPlacements.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => togglePlacement(p)}
                      className="tap inline-flex items-center gap-1.5 rounded-pill border border-ink-navy bg-ink-navy px-3 py-1.5 text-[12px] font-medium text-chalk-white transition hover:bg-ink-navy/85"
                    >
                      {p}
                      <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
                        <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                      </svg>
                    </button>
                  ))}
                  {customPlacements.length === 0 && (
                    <span className="text-[12px] text-muted">
                      No placements yet — add one below.
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={customPlacement}
                    onChange={(e) => setCustomPlacement(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addCustomPlacement();
                      }
                    }}
                    placeholder="Custom placement, e.g. Blouse bottom"
                    className="w-full rounded-card border border-hairline-strong bg-chalk-white px-3 py-2 text-[14px] text-ink outline-none transition focus:border-ink-navy"
                  />
                  <button
                    type="button"
                    onClick={addCustomPlacement}
                    className="tap shrink-0 rounded-card border border-ink-navy px-4 text-[13px] font-semibold text-ink-navy transition hover:bg-mist-navy"
                  >
                    Add
                  </button>
                </div>
              </div>
            </Field>

            {/* Default Variation picker */}
            <Field label="Default Variation" hint="Pre-selected add-on variation">
              {target.mode === "edit" ? (
                defaultChildrenLoading ? (
                  <div className="py-2 text-[13px] text-muted">Loading variations…</div>
                ) : addonVariations.length === 0 ? (
                  <div className="rounded-card border border-dashed border-hairline-strong px-3 py-2.5 text-[12px] text-muted">
                    No variations yet. Add add-on variations first, then set a default.
                  </div>
                ) : (
                  <Select
                    value={defaultAddonVariationId}
                    onChange={setDefaultAddonVariationId}
                    placeholder="None"
                    options={addonVariations.map((v) => ({
                      value: v.id,
                      label: getLabel(v.labels, v.slug, v.id),
                    }))}
                  />
                )
              ) : (
                <div className="rounded-card border border-dashed border-hairline-strong px-3 py-2.5 text-[12px] text-muted">
                  Save the add-on first, then add variations to choose a default.
                </div>
              )}
            </Field>

            {/* Style Component multi-select */}
            <Field label="Linked Style Components" hint="Select which style components this add-on belongs to">
              {componentsLoading ? (
                <div className="flex items-center gap-2 py-2 text-[13px] text-muted">
                  <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 16 16" fill="none">
                    <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.25" />
                    <path d="M8 1.5a6.5 6.5 0 0 1 6.5 6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                  Loading components...
                </div>
              ) : availableComponents.length === 0 ? (
                <div className="rounded-card border border-dashed border-hairline-strong px-3 py-2.5 text-[12px] text-muted">
                  No style components found for this garment. Create style components first.
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {availableComponents.map((comp) => {
                    const checked = selectedComponentIds.has(comp.id) ||
                      (isAddonInComponentView && target.mode === "create" && view.componentId === comp.id);
                    return (
                      <button
                        key={comp.id}
                        type="button"
                        onClick={() => {
                          const next = new Set(selectedComponentIds);
                          if (next.has(comp.id)) next.delete(comp.id);
                          else next.add(comp.id);
                          setSelectedComponentIds(next);
                        }}
                        className={`tap inline-flex items-center gap-1.5 rounded-pill border px-3 py-1.5 text-[12px] font-medium transition ${
                          checked
                            ? "border-ink-navy bg-ink-navy text-chalk-white"
                            : "border-hairline-strong text-ink hover:bg-mist-navy"
                        }`}
                      >
                        <span className={`flex h-3.5 w-3.5 items-center justify-center rounded-pill border ${
                          checked ? "border-chalk-white bg-chalk-white" : "border-muted"
                        }`}>
                          {checked && (
                            <svg className="h-2.5 w-2.5 text-ink-navy" viewBox="0 0 10 10" fill="none">
                              <path d="M2 5l2 2L8 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </span>
                        {getLabel(comp.labels, comp.slug, comp.id)}
                      </button>
                    );
                  })}
                </div>
              )}
            </Field>
          </>
        )}

        {/* Addon Variation specific */}
        {target.kind === "addonVariation" && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Style">
              <TextInput value={style} onChange={setStyle} placeholder="e.g. classic" />
            </Field>
            <Field label="Shape">
              <TextInput value={shape} onChange={setShape} placeholder="e.g. round" />
            </Field>
            <Field label="Size">
              <TextInput value={size} onChange={setSize} placeholder="e.g. M" />
            </Field>
            <Field label="Type">
              <TextInput value={type} onChange={setType} placeholder="e.g. button" />
            </Field>
            <Field label="Color">
              <TextInput value={color} onChange={setColor} placeholder="e.g. navy" />
            </Field>
            <Field label="Placement" hint="Blank = price applies at every placement">
              {showCustomPlacementInput ? (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={placement}
                    onChange={(e) => setPlacement(e.target.value)}
                    placeholder="Custom placement, e.g. Blouse bottom"
                    className="w-full rounded-card border border-hairline-strong bg-chalk-white px-3 py-2 text-[14px] text-ink outline-none transition focus:border-ink-navy"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setCustomPlacementMode(false);
                      // Exiting custom with a non-vocabulary value resets to blank
                      // (= every placement) — pick an option instead.
                      if (placement && !placementOptions.includes(placement))
                        setPlacement("");
                    }}
                    className="tap shrink-0 rounded-card border border-ink-navy px-4 text-[13px] font-semibold text-ink-navy transition hover:bg-mist-navy"
                  >
                    Dropdown
                  </button>
                </div>
              ) : (
                <Select
                  value={placement}
                  onChange={(v) => {
                    if (v === "__custom__") setCustomPlacementMode(true);
                    else setPlacement(v);
                  }}
                  placeholder="Every placement"
                  options={[
                    ...placementOptions.map((p) => ({ value: p, label: p })),
                    { value: "__custom__", label: "Custom…" },
                  ]}
                />
              )}
            </Field>
            <Field label="Price (\u20B9)">
              <TextInput value={price} onChange={setPrice} type="number" placeholder="0" />
            </Field>
            <Field label="Priority Order">
              <TextInput value={priority} onChange={setPriority} type="number" placeholder="0" />
            </Field>
          </div>
        )}

        {/* Measurements to take (entity → metric links) — edit mode + measurable kinds only */}
        {target.mode === "edit" &&
          MEASURABLE_KINDS[target.kind] &&
          typeof d?.id === "string" && (
            <EntityMetricsSection
              entityType={MEASURABLE_KINDS[target.kind]!}
              entityId={d.id}
            />
          )}

        {/* Error */}
        {error && <div className="flex items-center gap-2 rounded-card bg-red-50 px-3 py-2.5 text-[13px] text-red-700">
          <svg className="h-4 w-4 shrink-0" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.2" />
            <path d="M8 5v3.5M8 10.5v.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          {error}
        </div>}

        {/* Actions */}
        <div className="flex justify-end gap-2 border-t border-hairline pt-4">
          <button
            onClick={onClose}
            className="tap rounded-pill border border-hairline-strong px-5 py-2 text-[13px] font-medium text-ink hover:bg-mist-navy"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="tap inline-flex items-center gap-2 rounded-pill bg-ink-navy px-5 py-2 text-[13px] font-medium text-chalk-white transition hover:bg-ink-navy/90 active:scale-95 disabled:opacity-50"
          >
            {saving && (
              <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.25" />
                <path d="M8 1.5a6.5 6.5 0 0 1 6.5 6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            )}
            {saving ? "Saving..." : target.mode === "create" ? "Create" : "Save Changes"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Small form helpers
// ═══════════════════════════════════════════════════════════════════════════════
