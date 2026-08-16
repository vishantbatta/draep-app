"use client";

/**
 * Bulk AI generation for ONE catalogue list (all garments, the style
 * components of a garment, the variations of a component, …).
 *
 * Flow: every entity starts selected (rows can be deselected), languages
 * for titles + descriptions are picked globally (removable per entity),
 * image generation is toggled globally (opt-out per entity) → Run.
 *
 * The runner processes up to `concurrency` entities in parallel (default 3).
 * Within one entity the steps stay ordered — each language's call sees the
 * previously generated text as context, and the image is rendered from the
 * final names/descriptions. A stopped run can be resumed: finished entities
 * keep their staged results, only pending/failed ones are re-processed.
 * Every result is STAGED locally; nothing is written to the catalogue until
 * "Save generated content" is pressed (one partial PUT per changed entity).
 * Closing the modal (or stopping the run) discards staged results.
 */

import { useMemo, useRef, useState } from "react";
import {
  aiDescribe,
  aiGenerateImage,
  updateGarment,
  updateStyleComponent,
  updateVariation,
  updateVariationType,
  updateAddon,
  updateAddonVariation,
  type AiEntityType,
  type GarmentUpdateInput,
  type StyleComponentUpdateInput,
  type VariationUpdateInput,
  type VariationTypeUpdateInput,
  type AddonUpdateInput,
  type AddonVariationUpdateInput,
} from "@/lib/admin-api";
import { Modal } from "./catalogue-helpers";
import { AiErrorNote } from "../../_shared/ai-content";

// ─── Language vocabulary (mirrors the form's LangRowEditor options) ─────────

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

function langLabel(code: string): string {
  return LANGUAGE_OPTIONS.find((o) => o.code === code)?.label ?? code;
}

// ─── Types ──────────────────────────────────────────────────────────────────

/** Any catalogue row — every level structurally satisfies this. */
export interface BulkEntity {
  id: string;
  slug?: string | null;
  labels?: Record<string, string> | null;
  descriptions?: Record<string, string> | null;
  asset_urls?: string[] | null;
  // Add-on variation axes / component importance — display only.
  style?: string | null;
  shape?: string | null;
  size?: string | null;
  type?: string | null;
  color?: string | null;
  placement?: string | null;
  importance?: string | null;
}

interface StagedResult {
  labels: Record<string, string>;
  descriptions: Record<string, string>;
  imageUrl: string | null;
  langsGenerated: string[];
  nameAdded: string[];
}

type Phase = "pending" | "working" | "done" | "error";

interface ItemState {
  phase: Phase;
  stepsDone: number;
  stepsTotal: number;
  stepLabel: string;
  failedSteps: string[];
  error?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function entityName(e: BulkEntity): string {
  const labels = e.labels ?? {};
  return labels.en || Object.values(labels).find((v) => v?.trim()) || e.slug || e.id.slice(0, 8);
}

function axisChips(e: BulkEntity): string[] {
  return [e.style, e.shape, e.size, e.color, e.placement, e.type, e.importance].filter(
    (v): v is string => !!v,
  );
}

/**
 * Content-status tags, one per language that has anything: "EN·TD" means
 * title + description exist in English, "HI·D" description only, "HI·T"
 * title only — plus an IMG tag when the entity has images.
 */
function contentChips(e: BulkEntity): { label: string; title: string }[] {
  const chips: { label: string; title: string }[] = [];
  const codes = new Set([...Object.keys(e.labels ?? {}), ...Object.keys(e.descriptions ?? {})]);
  const ordered = [...codes].sort((a, b) =>
    a === "en" ? -1 : b === "en" ? 1 : a.localeCompare(b),
  );
  for (const code of ordered) {
    const hasTitle = !!e.labels?.[code]?.trim();
    const hasDesc = !!e.descriptions?.[code]?.trim();
    if (!hasTitle && !hasDesc) continue;
    const parts = [hasTitle ? "title" : null, hasDesc ? "description" : null]
      .filter(Boolean)
      .join(" + ");
    chips.push({
      label: `${code.toUpperCase()}·${hasTitle ? "T" : ""}${hasDesc ? "D" : ""}`,
      title: `${langLabel(code)}: ${parts}`,
    });
  }
  if ((e.asset_urls ?? []).length > 0) {
    chips.push({ label: "IMG", title: "Already has an image" });
  }
  return chips;
}

async function persist(kind: AiEntityType, id: string, patch: Record<string, unknown>) {
  switch (kind) {
    case "garment":
      return updateGarment(id, patch as GarmentUpdateInput);
    case "component":
      return updateStyleComponent(id, patch as StyleComponentUpdateInput);
    case "variation":
      return updateVariation(id, patch as VariationUpdateInput);
    case "variation_type":
      return updateVariationType(id, patch as VariationTypeUpdateInput);
    case "addon":
      return updateAddon(id, patch as AddonUpdateInput);
    case "addon_variation":
      return updateAddonVariation(id, patch as AddonVariationUpdateInput);
  }
}

// ─── Small presentational bits ──────────────────────────────────────────────

function SparkleIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none">
      <path
        d="M8 1.5l1.3 3.7L13 6.5l-3.7 1.3L8 11.5l-1.3-3.7L3 6.5l3.7-1.3L8 1.5z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="M12.5 10.5l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6.6-1.6z"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SpinnerIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg className={`${className} animate-spin`} viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="10 30" />
      <path d="M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** The CTA rendered next to each catalogue list's "Add" button. */
export function BulkGenerateButton({
  onClick,
  disabled,
}: {
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title="Generate AI descriptions & images for many entities at once"
      className="tap inline-flex items-center gap-1.5 rounded-pill border border-accent-text/40 bg-chalk-white px-3.5 py-1.5 text-[13px] font-medium text-accent-text transition hover:bg-mist-navy active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <SparkleIcon />
      Bulk Generate
    </button>
  );
}

// ─── The modal ──────────────────────────────────────────────────────────────

export function BulkGenerateModal({
  kind,
  sectionTitle,
  items,
  onClose,
  onSaved,
}: {
  kind: AiEntityType;
  sectionTitle: string;
  items: BulkEntity[];
  onClose: () => void;
  /** Called after a fully successful save-all (parent closes + reloads). */
  onSaved: () => void;
}) {
  // ── Config state (before the run) ──
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(items.map((e) => e.id)),
  );
  const [langs, setLangs] = useState<Set<string>>(() => new Set(["en"]));
  const [imagesOn, setImagesOn] = useState(true);
  // Parallel entities during a run (each entity's own steps stay ordered).
  const [concurrency, setConcurrency] = useState(3);
  // Per-entity overrides: removed languages / image opt-outs.
  const [langOff, setLangOff] = useState<Record<string, Set<string>>>({});
  const [imgOff, setImgOff] = useState<Set<string>>(() => new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Entities whose staged drafts are EXCLUDED from save-all (unticked rows).
  const [saveOff, setSaveOff] = useState<Set<string>>(() => new Set());

  // ── Run state ──
  const [runState, setRunState] = useState<"idle" | "running" | "finished">("idle");
  const [wasCancelled, setWasCancelled] = useState(false);
  const [itemStates, setItemStates] = useState<Record<string, ItemState>>({});
  const [staged, setStaged] = useState<Record<string, StagedResult>>({});
  const cancelRef = useRef(false);

  // ── Save state ──
  const [saving, setSaving] = useState<{ on: boolean; done: number; total: number }>({
    on: false,
    done: 0,
    total: 0,
  });
  const [saveError, setSaveError] = useState<string | null>(null);

  // Effective plans ── global choices minus per-entity overrides.
  const effLangs = (e: BulkEntity): string[] =>
    [...langs].filter((l) => !langOff[e.id]?.has(l));
  const imageFor = (e: BulkEntity): boolean => imagesOn && !imgOff.has(e.id);
  const plannedSteps = (e: BulkEntity): number => effLangs(e).length + (imageFor(e) ? 1 : 0);

  const runList = useMemo(
    () => items.filter((e) => selectedIds.has(e.id) && plannedSteps(e) > 0),
    // plannedSteps depends on config state; recompute on those.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, selectedIds, langs, langOff, imagesOn, imgOff],
  );

  const plannedCalls = useMemo(
    () => runList.reduce((n, e) => n + plannedSteps(e), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runList, langs, langOff, imagesOn, imgOff],
  );

  const totalSteps = useMemo(
    () => Object.values(itemStates).reduce((n, s) => n + s.stepsTotal, 0),
    [itemStates],
  );
  const doneSteps = useMemo(
    () => Object.values(itemStates).reduce((n, s) => n + s.stepsDone, 0),
    [itemStates],
  );

  // ── Config handlers ──

  function toggleEntity(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleLang(code: string) {
    setLangs((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  function toggleEntityLang(id: string, code: string) {
    setLangOff((prev) => {
      const forEntity = new Set(prev[id] ?? []);
      if (forEntity.has(code)) forEntity.delete(code);
      else forEntity.add(code);
      return { ...prev, [id]: forEntity };
    });
  }

  function toggleEntityImage(id: string) {
    setImgOff((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSaveOff(id: string) {
    setSaveOff((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Deselect entities that already have everything this run would generate. */
  function deselectFilled() {
    const filled = new Set(
      items
        .filter((e) => {
          const descs = e.descriptions ?? {};
          const labels = e.labels ?? {};
          const langsDone = [...langs].every(
            (l) => !!descs[l]?.trim() && !!labels[l]?.trim(),
          );
          const imageDone = !imagesOn || (e.asset_urls ?? []).length > 0;
          return langsDone && imageDone;
        })
        .map((e) => e.id),
    );
    setSelectedIds((prev) => new Set([...prev].filter((id) => !filled.has(id))));
  }

  // ── The runner ──

  /** Generate for ONE entity — only the gaps not already staged. */
  async function processEntity(e: BulkEntity, prior: StagedResult | undefined) {
    if (cancelRef.current) return;

    const labels = { ...(prior?.labels ?? e.labels ?? {}) };
    const descs = { ...(prior?.descriptions ?? e.descriptions ?? {}) };
    const langsGenerated = [...(prior?.langsGenerated ?? [])];
    const nameAdded = [...(prior?.nameAdded ?? [])];
    let imageUrl = prior?.imageUrl ?? null;
    const failedSteps: string[] = [];
    let succeeded = 0;
    let firstError: string | undefined;

    const patch = (p: Partial<ItemState>) =>
      setItemStates((prev) => ({
        ...prev,
        [e.id]: { ...prev[e.id], ...p },
      }));
    const stepDone = () =>
      setItemStates((prev) => ({
        ...prev,
        [e.id]: { ...prev[e.id], stepsDone: prev[e.id].stepsDone + 1 },
      }));
    // Stage after EVERY success so previews render live, language by language.
    const stageNow = () =>
      setStaged((prev) => ({
        ...prev,
        [e.id]: {
          labels,
          descriptions: descs,
          imageUrl,
          langsGenerated: [...langsGenerated],
          nameAdded: [...nameAdded],
        },
      }));

    patch({ phase: "working", failedSteps: [], error: undefined });

    for (const lang of effLangs(e).filter((l) => !langsGenerated.includes(l))) {
      if (cancelRef.current) break;
      patch({ stepLabel: `writing ${langLabel(lang)}…` });
      try {
        const res = await aiDescribe({
          entity_type: kind,
          entity_id: e.id,
          parent_id: null,
          language: lang,
          name: labels[lang]?.trim() || null,
          names: labels,
          existing_description: descs[lang]?.trim() || null,
          descriptions: descs,
        });
        descs[lang] = res.description;
        if (!labels[lang]?.trim() && res.name) {
          labels[lang] = res.name;
          nameAdded.push(lang);
        }
        langsGenerated.push(lang);
        succeeded += 1;
        stageNow();
      } catch (err) {
        failedSteps.push(langLabel(lang));
        firstError ??= err instanceof Error ? err.message : "AI call failed";
      }
      stepDone();
    }

    if (imageFor(e) && !imageUrl && !cancelRef.current) {
      patch({ stepLabel: "rendering image…" });
      try {
        const res = await aiGenerateImage({
          entity_type: kind,
          entity_id: e.id,
          parent_id: null,
          names: labels,
          descriptions: descs,
        });
        imageUrl = res.url;
        succeeded += 1;
        stageNow();
      } catch (err) {
        failedSteps.push("image");
        firstError ??= err instanceof Error ? err.message : "Image generation failed";
      }
      stepDone();
    }

    if (succeeded > 0) {
      patch({ phase: "done", failedSteps, stepLabel: "" });
    } else if (failedSteps.length > 0 && !cancelRef.current) {
      patch({ phase: "error", failedSteps, error: firstError, stepLabel: "" });
    } else {
      patch({ phase: "pending", stepLabel: "" });
    }
  }

  /** True when this entity still has unfilled work under the current config. */
  function hasGaps(e: BulkEntity, prior: StagedResult | undefined): boolean {
    return (
      effLangs(e).some((l) => !prior?.langsGenerated.includes(l)) ||
      (imageFor(e) && !prior?.imageUrl)
    );
  }

  /**
   * Fresh run (resume=false) resets everything. A resume keeps finished
   * entities' staged results and only fills the remaining gaps — unstarted
   * entities, failed steps, and partial failures alike. Up to `concurrency`
   * entities generate in parallel via a worker pool.
   */
  async function run(resume: boolean) {
    cancelRef.current = false;
    setSaveError(null);
    setWasCancelled(false);

    const priorById: Record<string, StagedResult> = resume ? { ...staged } : {};
    if (!resume) {
      setStaged({});
      setSaveOff(new Set());
    }

    const todo = runList.filter((e) => hasGaps(e, priorById[e.id]));

    setItemStates((prev) => {
      const next: Record<string, ItemState> = resume ? { ...prev } : {};
      for (const e of todo) {
        const prior = priorById[e.id];
        const gaps =
          effLangs(e).filter((l) => !prior?.langsGenerated.includes(l)).length +
          (imageFor(e) && !prior?.imageUrl ? 1 : 0);
        next[e.id] = {
          phase: "pending",
          stepsDone: 0,
          stepsTotal: gaps,
          stepLabel: "",
          failedSteps: [],
        };
      }
      return next;
    });
    setRunState("running");

    const queue = [...todo];
    let cursor = 0;
    const worker = async () => {
      while (!cancelRef.current) {
        const idx = cursor++;
        if (idx >= queue.length) return;
        const e = queue[idx];
        await processEntity(e, priorById[e.id]);
      }
    };
    const threads = Math.max(1, Math.min(concurrency, queue.length));
    await Promise.all(Array.from({ length: threads }, worker));

    if (cancelRef.current) setWasCancelled(true);
    setRunState("finished");
  }

  function stopRun() {
    cancelRef.current = true;
  }

  function handleClose() {
    cancelRef.current = true; // in-flight call finishes, then the loop stops
    onClose();
  }

  // ── Save-all ──

  async function saveAll() {
    const changed = items.filter((e) => staged[e.id] && !saveOff.has(e.id));
    if (changed.length === 0) return;
    setSaving({ on: true, done: 0, total: changed.length });
    setSaveError(null);

    const errors: string[] = [];
    let done = 0;
    for (const e of changed) {
      const s = staged[e.id]!;
      const patchBody: Record<string, unknown> = {};
      if (JSON.stringify(s.labels) !== JSON.stringify(e.labels ?? {})) {
        patchBody.labels = s.labels;
      }
      if (JSON.stringify(s.descriptions) !== JSON.stringify(e.descriptions ?? {})) {
        patchBody.descriptions = s.descriptions;
      }
      if (s.imageUrl) {
        patchBody.asset_urls = [s.imageUrl, ...(e.asset_urls ?? [])];
      }
      if (Object.keys(patchBody).length > 0) {
        try {
          await persist(kind, e.id, patchBody);
        } catch (err) {
          errors.push(
            `${entityName(e)}: ${err instanceof Error ? err.message : "save failed"}`,
          );
          continue;
        }
      }
      done += 1;
      setSaving({ on: true, done, total: changed.length });
    }

    setSaving({ on: false, done, total: changed.length });
    if (errors.length > 0) {
      setSaveError(errors.join(" · "));
    } else {
      onSaved();
    }
  }

  // ── Derived for render ──

  const saveCount = items.filter((e) => staged[e.id] && !saveOff.has(e.id)).length;
  const stagedCountAny = items.filter((e) => staged[e.id]).length;
  const canStart = runState === "idle" && plannedCalls > 0;
  const estMinutes = Math.max(1, Math.round(plannedCalls * 8 / concurrency / 60));
  // After a run stops/finishes: entities with work still unfilled — unstarted,
  // fully failed, or partially failed (some languages/image missing).
  const remainingCount = useMemo(
    () => runList.filter((e) => hasGaps(e, staged[e.id])).length,
    // hasGaps also reads the config state via closures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runList, staged, langs, langOff, imagesOn, imgOff],
  );

  // ── Render ──

  return (
    <Modal
      open
      title={`Bulk Generate — ${sectionTitle}`}
      onClose={handleClose}
      maxWidth="max-w-2xl"
    >
      {runState === "idle" ? (
        /* ── Configuration ── */
        <div className="space-y-4">
          {/* Languages */}
          <div className="rounded-card border border-hairline bg-mist-navy/40 p-3">
            <div className="text-[13px] font-semibold text-ink-navy">
              Languages for titles &amp; descriptions
            </div>
            <p className="mt-0.5 text-[11px] text-muted">
              Titles are only written where the entity has none in that language; descriptions
              are always written.
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {LANGUAGE_OPTIONS.map((o) => {
                const on = langs.has(o.code);
                return (
                  <button
                    key={o.code}
                    type="button"
                    onClick={() => toggleLang(o.code)}
                    className={`tap rounded-pill border px-2.5 py-1 text-[12px] font-medium transition ${
                      on
                        ? "border-accent-text/50 bg-accent-text/10 text-accent-text"
                        : "border-hairline-strong bg-chalk-white text-muted hover:bg-mist-navy"
                    }`}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Images */}
          <label className="flex cursor-pointer items-start gap-2.5 rounded-card border border-hairline p-3">
            <input
              type="checkbox"
              checked={imagesOn}
              onChange={(e) => setImagesOn(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-ink-navy"
            />
            <span>
              <span className="block text-[13px] font-semibold text-ink-navy">
                Generate an image for each entity
              </span>
              <span className="block text-[11px] text-muted">
                Rendered from the name, description, parent tree &amp; siblings — one new image
                is prepended to each entity&apos;s assets.
              </span>
            </span>
          </label>

          {/* Entities */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[12px] font-medium text-ink-navy">
                Entities
                <span className="ml-1.5 font-mono text-[11px] text-muted">
                  {selectedIds.size}/{items.length} selected
                </span>
              </span>
              <span className="flex gap-2 text-[11px]">
                <button
                  type="button"
                  onClick={() => setSelectedIds(new Set(items.map((e) => e.id)))}
                  className="text-accent-text hover:underline"
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={deselectFilled}
                  className="text-accent-text hover:underline"
                  title="Deselect entities that already have descriptions in every selected language (and an image, if enabled)"
                >
                  Skip filled
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedIds(new Set())}
                  className="text-muted hover:underline"
                >
                  Clear
                </button>
              </span>
            </div>

            <div className="max-h-64 space-y-1.5 overflow-y-auto pr-0.5">
              {items.map((e) => {
                const selected = selectedIds.has(e.id);
                const expanded = expandedId === e.id;
                const eff = effLangs(e);
                const removed = [...langs].filter((l) => !eff.includes(l));
                return (
                  <div
                    key={e.id}
                    className={`rounded-card border transition ${
                      selected ? "border-hairline-strong" : "border-dashed border-hairline opacity-60"
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2 px-2.5 py-2">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleEntity(e.id)}
                        className="h-4 w-4 accent-ink-navy"
                        aria-label={`Include ${entityName(e)}`}
                      />
                      <span className="min-w-0 flex-1 truncate text-[13px] text-ink-navy">
                        {entityName(e)}
                      </span>
                      {contentChips(e).map((chip) => (
                        <span
                          key={chip.label}
                          title={chip.title}
                          className="shrink-0 rounded-pill border border-hairline-strong px-1.5 py-0.5 font-mono text-[9px] uppercase text-muted"
                        >
                          {chip.label}
                        </span>
                      ))}
                      {axisChips(e).map((chip) => (
                        <span
                          key={chip}
                          className="shrink-0 rounded-pill bg-mist-navy px-1.5 py-0.5 text-[10px] text-ink-navy"
                        >
                          {chip}
                        </span>
                      ))}
                      <button
                        type="button"
                        onClick={() => setExpandedId(expanded ? null : e.id)}
                        className="tap shrink-0 rounded-pill border border-hairline-strong px-2 py-0.5 text-[11px] text-muted transition hover:bg-mist-navy hover:text-ink-navy"
                      >
                        Options
                      </button>
                    </div>

                    {expanded && (
                      <div className="space-y-2 border-t border-hairline bg-mist-navy/30 px-2.5 py-2">
                        <div>
                          <div className="text-[11px] font-medium text-ink-navy">
                            Languages for this entity
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            {eff.map((l) => (
                              <span
                                key={l}
                                className="inline-flex items-center gap-1 rounded-pill border border-accent-text/40 bg-accent-text/10 px-2 py-0.5 text-[11px] text-accent-text"
                              >
                                {langLabel(l)}
                                <button
                                  type="button"
                                  onClick={() => toggleEntityLang(e.id, l)}
                                  title={`Skip ${langLabel(l)} for this entity`}
                                  className="hover:text-red-600"
                                >
                                  <svg className="h-2.5 w-2.5" viewBox="0 0 16 16" fill="none">
                                    <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                  </svg>
                                </button>
                              </span>
                            ))}
                            {eff.length === 0 && (
                              <span className="text-[11px] text-muted">
                                No languages — only the image (if on) will be generated.
                              </span>
                            )}
                            {removed.map((l) => (
                              <button
                                key={l}
                                type="button"
                                onClick={() => toggleEntityLang(e.id, l)}
                                className="rounded-pill border border-dashed border-hairline-strong px-2 py-0.5 text-[11px] text-muted transition hover:text-ink-navy"
                                title={`Restore ${langLabel(l)}`}
                              >
                                + {langLabel(l)}
                              </button>
                            ))}
                          </div>
                        </div>
                        <label className="flex cursor-pointer items-center gap-2 text-[12px] text-ink-navy">
                          <input
                            type="checkbox"
                            checked={imageFor(e)}
                            onChange={() => toggleEntityImage(e.id)}
                            className="h-3.5 w-3.5 accent-ink-navy"
                          />
                          Generate image for this entity
                        </label>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Footer */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-3">
            <p className="text-[11px] text-muted">
              {plannedCalls > 0 ? (
                <>
                  {plannedCalls} AI call{plannedCalls === 1 ? "" : "s"} · est. {estMinutes} min ·{" "}
                  {concurrency} in parallel
                </>
              ) : (
                "Nothing to generate — pick at least one language or enable images."
              )}
            </p>
            <div className="flex items-center gap-2">
              <label
                className="flex items-center gap-1.5 text-[11px] text-muted"
                title="How many entities generate at the same time. Higher values finish sooner but may hit AI rate limits."
              >
                Parallel
                <select
                  value={concurrency}
                  onChange={(e) => setConcurrency(Number(e.target.value))}
                  className="rounded-card border border-hairline-strong bg-chalk-white px-1.5 py-1.5 text-[12px] text-ink-navy outline-none focus:border-ink-navy"
                >
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <option key={n} value={n}>
                      {n}×
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() => void run(false)}
                disabled={!canStart}
                className="tap inline-flex items-center gap-1.5 rounded-pill bg-ink-navy px-4 py-2 text-[13px] font-medium text-chalk-white transition hover:bg-ink-navy/90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <SparkleIcon />
                Generate
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* ── Progress / results ── */
        <div className="space-y-3">
          {/* Overall */}
          <div>
            <div className="mb-1 flex items-center justify-between text-[12px]">
              <span className="font-medium text-ink-navy">
                {runState === "running"
                  ? `Generating… keep this tab open (${concurrency} in parallel)`
                  : wasCancelled
                    ? "Stopped — resume to finish the rest"
                    : "Finished"}
              </span>
              <span className="font-mono text-[11px] text-muted">
                {doneSteps}/{totalSteps} steps
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-pill bg-mist-navy">
              <div
                className="h-full rounded-pill bg-accent-text transition-all"
                style={{ width: `${totalSteps === 0 ? 0 : (doneSteps / totalSteps) * 100}%` }}
              />
            </div>
          </div>

          {/* Per-entity list */}
          <div className="max-h-72 space-y-1.5 overflow-y-auto pr-0.5">
            {runList.map((e) => {
              const st = itemStates[e.id];
              if (!st) return null;
              const result = staged[e.id];
              return (
                <div
                  key={e.id}
                  className="rounded-card border border-hairline px-2.5 py-2"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                      {st.phase === "working" ? (
                        <SpinnerIcon className="h-3.5 w-3.5 text-accent-text" />
                      ) : st.phase === "done" ? (
                        <svg className="h-3.5 w-3.5 text-green-600" viewBox="0 0 16 16" fill="none">
                          <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      ) : st.phase === "error" ? (
                        <svg className="h-3.5 w-3.5 text-red-600" viewBox="0 0 16 16" fill="none">
                          <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                        </svg>
                      ) : (
                        <span className="h-2 w-2 rounded-full border border-hairline-strong" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink-navy">
                      {entityName(e)}
                    </span>
                    {axisChips(e).map((chip) => (
                      <span
                        key={chip}
                        className="shrink-0 rounded-pill bg-mist-navy px-1.5 py-0.5 text-[10px] text-ink-navy"
                      >
                        {chip}
                      </span>
                    ))}
                    {result && (
                      <label
                        className="flex shrink-0 cursor-pointer items-center gap-1 text-[10px] text-muted"
                        title="Untick to leave this draft out when saving"
                      >
                        <input
                          type="checkbox"
                          checked={!saveOff.has(e.id)}
                          onChange={() => toggleSaveOff(e.id)}
                          disabled={saving.on}
                          className="h-3.5 w-3.5 accent-ink-navy"
                        />
                        save
                      </label>
                    )}
                    <span className="shrink-0 font-mono text-[11px] text-muted">
                      {st.stepsTotal === 0
                        ? "skipped"
                        : `${st.stepsDone}/${st.stepsTotal}`}
                    </span>
                  </div>

                  {(st.stepLabel || st.failedSteps.length > 0 || st.error) && (
                    <p className="mt-1 pl-7 text-[11px] text-muted">
                      {st.stepLabel}
                      {st.stepLabel && st.failedSteps.length > 0 ? " · " : ""}
                      {st.failedSteps.length > 0 && (
                        <span className="text-error-text">
                          failed: {st.failedSteps.join(", ")}
                        </span>
                      )}
                      {st.error ? ` — ${st.error}` : ""}
                    </p>
                  )}

                  {result && (
                    <div className="mt-1.5 space-y-1.5 border-t border-hairline pl-7 pt-1.5">
                      {result.langsGenerated.map((l) => (
                        <div key={l}>
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                            {langLabel(l)}
                            {result.nameAdded.includes(l) ? " · title added" : ""}
                          </span>
                          <p className="text-[12px] leading-relaxed text-ink">
                            {result.descriptions[l]}
                          </p>
                        </div>
                      ))}
                      {result.imageUrl && (
                        <a
                          href={result.imageUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="block w-24 overflow-hidden rounded-card border border-hairline-strong"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={result.imageUrl} alt="" className="aspect-square w-full object-cover" />
                        </a>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <div className="border-t border-hairline pt-3">
            {runState === "running" ? (
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] text-muted">
                  Previews appear as each language and image lands — stop anytime and resume
                  later; nothing is saved until you press save.
                </p>
                <button
                  type="button"
                  onClick={stopRun}
                  className="tap shrink-0 rounded-pill border border-hairline-strong px-4 py-2 text-[13px] font-medium text-ink-navy transition hover:bg-mist-navy"
                >
                  Stop
                </button>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-[11px] text-muted">
                    {saveCount > 0
                      ? "Nothing is written until you press save — untick any row to leave its draft out."
                      : stagedCountAny > 0
                        ? "All drafts are unticked — tick the rows you want to save."
                        : "No results were generated — resume & retry, or close and start again."}
                  </p>
                  <div className="flex items-center gap-2">
                    {remainingCount > 0 && (
                      <button
                        type="button"
                        onClick={() => void run(true)}
                        className="tap inline-flex items-center gap-1.5 rounded-pill border border-hairline-strong px-4 py-2 text-[13px] font-medium text-ink-navy transition hover:bg-mist-navy"
                        title="Generate only what's missing — unstarted entities, failed steps, and partial failures"
                      >
                        <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none">
                          <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                          <path d="M13.7 1.8v2.7H11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        Resume &amp; retry ({remainingCount})
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void saveAll()}
                      disabled={saveCount === 0 || saving.on}
                      className="tap inline-flex items-center gap-1.5 rounded-pill bg-ink-navy px-4 py-2 text-[13px] font-medium text-chalk-white transition hover:bg-ink-navy/90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {saving.on ? <SpinnerIcon /> : <SparkleIcon />}
                      {saving.on
                        ? `Saving ${saving.done}/${saving.total}…`
                        : `Save selected drafts (${saveCount})`}
                    </button>
                  </div>
                </div>
                <AiErrorNote error={saveError} />
              </>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
