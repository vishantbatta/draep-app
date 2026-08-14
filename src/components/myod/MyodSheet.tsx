"use client";

/**
 * MyodSheet — "Make Your Own Draep", vector SVG configurator.
 *
 * Shows two SVG line drawings (front + back) of the blouse. On load, uses the
 * garment's asset_urls as the base SVGs. When the user selects a non-default
 * option, sends the current SVGs + full config + edit history to
 * /myod/svg-edit and gets back updated front + back SVGs.
 *
 * No render-mode toggle — just the one A1 (SVG edit) approach.
 */

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { BottomSheet } from "@/components/ui/BottomSheet";
import { Check, ChevronRight, Close, Plus, Sparkles } from "@/components/ui/icons";
import { getGarmentTree, listGarments } from "@/lib/api/catalog";
import { editBlouseSvg } from "@/lib/api/myod";
import {
  buildDesignSteps,
  describeSelection,
  labelText,
  placementLabel,
  selectionMatchesImage,
  type ComponentSelection,
  type DesignStep,
  type Selections,
  type StepComponent,
  type StepOption,
} from "@/lib/myod-steps";
import { strings } from "@/lib/strings";
import { track } from "@/lib/analytics";
import type { GarmentTreeOut } from "@/types/api";

type Phase = "loading-tree" | "ready" | "generating" | "error";

export function MyodSheet() {
  const [phase, setPhase] = useState<Phase>("loading-tree");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [tree, setTree] = useState<GarmentTreeOut | null>(null);
  const steps = useMemo(() => (tree ? buildDesignSteps(tree) : []), [tree]);

  const [activeStepIdx, setActiveStepIdx] = useState(0);
  const [selections, setSelections] = useState<Selections>({});

  // Current SVGs (start from asset_urls, then updated by svg-edit)
  const [frontSvg, setFrontSvg] = useState<string | null>(null);
  const [backSvg, setBackSvg] = useState<string | null>(null);

  // Track what the current SVGs depict (for skip-if-matches)
  const [imageSelections, setImageSelections] = useState<Selections>({});
  const genTokenRef = useRef(0);

  // Edit history (accumulated text)
  const historyRef = useRef<string[]>([]);

  // ── Load the blouse tree on mount ───────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setPhase("loading-tree");
      setErrorMsg(null);
      try {
        const list = await listGarments();
        const blouse = (list.items ?? []).find((g) => g.slug === "blouse")
          ?? (list.items ?? [])[0];
        if (!blouse) throw new Error("No blouse garment found.");
        const t = await getGarmentTree(blouse.id);
        if (cancelled) return;
        setTree(t);
        setSelections({});
        setImageSelections(defaultSelections(buildDesignSteps(t)));
        setActiveStepIdx(0);
        // Load base SVGs from asset_urls (fetch the SVG file content)
        const assets = t.asset_urls ?? [];
        const fetchSvg = async (url: string | undefined): Promise<string | null> => {
          if (!url) return null;
          try {
            const res = await fetch(url);
            if (!res.ok) return null;
            const text = await res.text();
            return text.trim().startsWith("<svg") ? text : null;
          } catch {
            return null;
          }
        };
        const front = await fetchSvg(assets[0]);
        const back = await fetchSvg(assets[1]) ?? front;
        if (cancelled) return;
        setFrontSvg(front);
        setBackSvg(back);
        setPhase("ready");
        track({ event: "myod_opened", source: "library" });
      } catch (err) {
        if (cancelled) return;
        setErrorMsg(err instanceof Error ? err.message : "Couldn't load the design options.");
        setPhase("error");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const activeStep: DesignStep | undefined = steps[activeStepIdx];
  const toggleIds = useMemo(
    () => new Set(
      steps.flatMap((s) => s.components).filter((c) => c.kind === "toggle").map((c) => c.id),
    ),
    [steps],
  );

  // ── Config summary builder ──────────────────────────────────────────
  const buildConfigSummary = useCallback(
    (sels: Selections): string => {
      if (!tree) return "";
      const lines: string[] = [];
      for (const c of sortedComponents(tree)) {
        const sel = sels[c.id];
        const def = c.defaultOptionId;
        const chosenId = sel?.variationId ?? def ?? c.options[0]?.id;
        const opt = c.options.find((o) => o.id === chosenId);
        if (!opt) continue;
        let line = `- ${c.label}: ${opt.label}`;
        if (c.description) line += ` — ${c.description}`;
        if (opt.description) line += ` | ${opt.description}`;
        if (sel?.variationTypeId && opt.subOptions) {
          const sub = opt.subOptions.find((s) => s.id === sel.variationTypeId);
          if (sub) {
            line += ` (${sub.label})`;
            if (sub.description) line += ` [${sub.description}]`;
          }
        }
        lines.push(line);
      }
      return lines.join("\n");
    },
    [tree],
  );

  // ── Apply an edit ───────────────────────────────────────────────────
  const applyChange = useCallback(
    async (
      changeLabel: string,
      changeDescription: string,
      allSelections: Selections,
    ) => {
      if (!frontSvg || !backSvg) return;
      const token = ++genTokenRef.current;
      setErrorMsg(null);
      setPhase("generating");

      const currentConfig = buildConfigSummary(imageSelections);
      const newConfig = buildConfigSummary(allSelections);
      const historyText = historyRef.current.length
        ? "EDIT HISTORY (all changes applied so far):\n" +
          historyRef.current.map((h, i) => `  ${i + 1}. ${h}`).join("\n")
        : "EDIT HISTORY: (none yet)";

      try {
        const result = await editBlouseSvg({
          currentFrontSvg: frontSvg,
          currentBackSvg: backSvg,
          currentConfig,
          newConfig,
          changeLabel,
          changeDescription,
          editHistory: historyText,
        });
        if (token !== genTokenRef.current) return;
        setFrontSvg(result.front_svg);
        setBackSvg(result.back_svg);
        setImageSelections(allSelections);
        historyRef.current.push(changeLabel);
        setPhase("ready");
        track({ event: "myod_succeeded" });
      } catch (err) {
        if (token !== genTokenRef.current) return;
        setErrorMsg(err instanceof Error ? err.message : "Something went wrong.");
        setPhase("ready");
        track({ event: "myod_failed", error: err instanceof Error ? err.message : undefined });
      }
    },
    [frontSvg, backSvg, imageSelections, buildConfigSummary],
  );

  // ── Option tap ──────────────────────────────────────────────────────
  const handleSelectOption = useCallback(
    (componentId: string, sel: ComponentSelection | null) => {
      const next = { ...selections };
      if (sel) next[componentId] = sel;
      else delete next[componentId];
      setSelections(next);

      const step = steps[activeStepIdx];
      const shouldAdvance = !step?.isExtras;
      const advance = () => {
        if (shouldAdvance) setActiveStepIdx((i) => Math.min(steps.length - 1, i + 1));
      };

      // Skip if matches current image
      if (selectionMatchesImage(next, imageSelections, toggleIds)) {
        advance();
        return;
      }

      const change = sel
        ? step
          ? describeSelection(step, componentId, sel)
          : ""
        : `${step?.components.find((c) => c.id === componentId)?.label ?? "Add-on"} → off`;

      // Build full change description with component + variation descriptions
      const comp = step?.components.find((c) => c.id === componentId);
      const opt = comp?.options.find((o) => o.id === sel?.variationId);
      let changeDesc = "";
      if (comp?.description) changeDesc += comp.description + "\n";
      if (opt?.description) changeDesc += opt.description;
      if (sel?.variationTypeId && opt?.subOptions) {
        const sub = opt.subOptions.find((s) => s.id === sel.variationTypeId);
        if (sub?.description) changeDesc += "\n" + sub.description;
      }

      track({ event: "myod_refined", instruction: change });
      void applyChange(change, changeDesc, next).then(advance);
    },
    [selections, imageSelections, steps, activeStepIdx, toggleIds, applyChange],
  );

  const retry = useCallback(() => {
    setErrorMsg(null);
    setPhase("ready");
  }, []);

  const hasNonDefault = Object.keys(selections).length > 0;

  return (
    <div className="relative mx-auto flex w-full max-w-column flex-col gap-4 px-4 pb-6">
      <AnimatePresence mode="wait">
        {phase === "loading-tree" && <LoadingTree key="lt" />}
        {phase === "error" && !frontSvg && (
          <ErrorStage key="err" message={errorMsg ?? "Something went wrong."} onRetry={retry} />
        )}
        {phase !== "loading-tree" && !(phase === "error" && !frontSvg) && (
          <motion.div
            key="main"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col gap-4"
          >
            {/* SVG previews */}
            <SvgStage
              frontSvg={frontSvg}
              backSvg={backSvg}
              generating={phase === "generating"}
            />

            {/* Step options */}
            {activeStep && (
              <StepCards
                step={activeStep}
                stepIndex={activeStepIdx}
                totalSteps={steps.length}
                selections={selections}
                disabled={phase === "generating"}
                onSelect={handleSelectOption}
              />
            )}

            {phase === "ready" && errorMsg && (
              <div className="flex items-center justify-between gap-2 rounded-card border border-error-border bg-error-bg px-3 py-2">
                <p className="text-caption text-error-text">{errorMsg}</p>
                <button
                  type="button"
                  onClick={retry}
                  className="shrink-0 rounded-pill border border-error-border bg-chalk-white px-3 py-1 text-[12px] font-semibold text-error-text transition-all active:scale-[0.97]"
                >
                  {strings.myod.errorRetry}
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function defaultSelections(steps: DesignStep[]): Selections {
  const out: Selections = {};
  for (const step of steps) {
    for (const comp of step.components) {
      if (comp.kind === "toggle") {
        if (comp.defaultOn) out[comp.id] = { variationId: "__toggle_on__" };
        continue;
      }
      const def = comp.defaultOptionId;
      if (!def) continue;
      const opt = comp.options.find((o) => o.id === def);
      out[comp.id] = {
        variationId: def,
        variationTypeId: opt?.defaultSubOptionId ?? opt?.subOptions?.[0]?.id,
      };
    }
  }
  return out;
}

function sortedComponents(tree: GarmentTreeOut) {
  // Flatten steps → components in display order
  return buildDesignSteps(tree).flatMap((s) => s.components);
}

/* ============================================================ */
/*  SVG stage (front + back)                                    */
/* ============================================================ */

function SvgStage({
  frontSvg, backSvg, generating,
}: {
  frontSvg: string | null;
  backSvg: string | null;
  generating: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {/* Front */}
      <div className="relative overflow-hidden rounded-card bg-mist-navy">
        <AnimatePresence mode="wait">
          {frontSvg && !generating ? (
            <motion.div
              key={frontSvg.slice(0, 40)}
              className="flex aspect-[400/460] w-full items-center justify-center [&_svg]:block [&_svg]:h-full [&_svg]:w-full"
              initial={{ opacity: 0.4, scale: 1.04 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
              // eslint-disable-next-line react/no-danger
              dangerouslySetInnerHTML={{ __html: frontSvg }}
            />
          ) : (
            <motion.div key="loading-front" className="flex aspect-[400/460] w-full items-center justify-center">
              <GeneratingLoader />
            </motion.div>
          )}
        </AnimatePresence>
        <div className="pointer-events-none absolute left-2 top-2 rounded-pill border border-white/10 bg-ink-navy px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-chalk-white shadow-[0_1px_2px_rgba(0,0,0,0.25)]">
          Front
        </div>
      </div>

      {/* Back */}
      <div className="relative overflow-hidden rounded-card bg-mist-navy">
        <AnimatePresence mode="wait">
          {backSvg && !generating ? (
            <motion.div
              key={backSvg.slice(0, 40)}
              className="flex aspect-[400/460] w-full items-center justify-center [&_svg]:block [&_svg]:h-full [&_svg]:w-full"
              initial={{ opacity: 0.4, scale: 1.04 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
              // eslint-disable-next-line react/no-danger
              dangerouslySetInnerHTML={{ __html: backSvg }}
            />
          ) : (
            <motion.div key="loading-back" className="flex aspect-[400/460] w-full items-center justify-center">
              <GeneratingLoader />
            </motion.div>
          )}
        </AnimatePresence>
        <div className="pointer-events-none absolute left-2 top-2 rounded-pill border border-white/10 bg-ink-navy px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-chalk-white shadow-[0_1px_2px_rgba(0,0,0,0.25)]">
          Back
        </div>
      </div>
    </div>
  );
}

/* ============================================================ */
/*  Step option cards (same as before)                         */
/* ============================================================ */

function StepCards({
  step, stepIndex, totalSteps, selections, disabled, onSelect,
}: {
  step: DesignStep;
  stepIndex: number;
  totalSteps: number;
  selections: Selections;
  disabled: boolean;
  onSelect: (componentId: string, sel: ComponentSelection | null) => void;
}) {
  // Extras step has no counter (it's the open-ended final step).
  const showCounter = !step.isExtras && totalSteps > 1;
  return (
    <div>
      <div className="mb-3 px-1">
        {showCounter && (
          <span className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
            Step {stepIndex + 1} / {totalSteps}
          </span>
        )}
        <span className="eyebrow">{strings.myod.chooseEyebrow}</span>
        <p className="mt-1 font-heading text-h3 font-semibold leading-snug text-ink-navy">{step.title}</p>
        <div className="mt-2 flex items-center gap-2" aria-hidden>
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-draep-orange shadow-[0_0_0_2px_rgba(248,144,16,0.22)]" />
          <span className="tick-divider flex-1" />
        </div>
      </div>

      {step.isExtras ? (
        <ExtrasList step={step} selections={selections} disabled={disabled} onSelect={onSelect} />
      ) : (
        <div className="flex flex-col gap-3">
          {step.components.map((comp) => (
            <ComponentCards
              key={comp.id}
              component={comp}
              showLabel={step.components.length > 1}
              selection={selections[comp.id]}
              disabled={disabled}
              onSelect={(sel) => onSelect(comp.id, sel)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// (ExtrasList, ComponentCards, ToggleCard, ChoiceCard — same as the existing
//  implementations. Importing them here would bloat the file; keeping inline.)

function ExtrasList({
  step, selections, disabled, onSelect,
}: {
  step: DesignStep; selections: Selections; disabled: boolean;
  onSelect: (componentId: string, sel: ComponentSelection | null) => void;
}) {
  // Which component's picker sheet is open (null = closed).
  const [openCompId, setOpenCompId] = useState<string | null>(null);

  // Group by section, preserving order of first appearance.
  const sections: { name: string; components: StepComponent[] }[] = [];
  for (const comp of step.components) {
    const name = comp.section ?? "Details";
    const existing = sections.find((s) => s.name === name);
    if (existing) existing.components.push(comp);
    else sections.push({ name, components: [comp] });
  }

  const openComp = step.components.find((c) => c.id === openCompId) ?? null;

  return (
    <>
      <div className="flex flex-col gap-6">
        {sections.map((sec) => (
          <section key={sec.name} className="flex flex-col gap-2.5">
            <ExtrasSectionHeader name={sec.name} />
            {sec.components.map((comp) => (
              <ExtrasRow
                key={comp.id}
                component={comp}
                selection={selections[comp.id]}
                disabled={disabled}
                onOpen={() => setOpenCompId(comp.id)}
                onClear={(e) => { e.stopPropagation(); onSelect(comp.id, null); }}
              />
            ))}
          </section>
        ))}
      </div>

      <BottomSheet
        open={!!openComp}
        onClose={() => setOpenCompId(null)}
        title={openComp?.label ?? ""}
      >
        {openComp && (
          <ExtrasPicker
            key={openComp.id}
            component={openComp}
            initialSelection={selections[openComp.id]}
            disabled={disabled}
            onConfirm={(sel) => {
              onSelect(openComp.id, sel);
              setOpenCompId(null);
            }}
          />
        )}
      </BottomSheet>
    </>
  );
}

// Branded section header: rivet dot + mono eyebrow + tick divider (Brand Book §6/§8).
function ExtrasSectionHeader({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-2">
      <span
        aria-hidden
        className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-draep-orange shadow-[0_0_0_2px_rgba(248,144,16,0.22)]"
      />
      <span className="font-mono text-eyebrow font-medium uppercase tracking-[0.18em] text-accent-text">
        {name}
      </span>
      <span className="tick-divider flex-1" aria-hidden />
    </div>
  );
}

/**
 * A single opt-in row on the extras page. Shows a thumbnail of the current
 * selection (if any), the label, the chosen value, and a chevron. Tapping the
 * whole row opens the bottom-sheet picker. Tapping the small ✕ clears it.
 *
 * Every row is opt-in: nothing shows a "selected" state unless the user has
 * actively chosen it (defaults seeded into selections are hidden by the caller
 * — see MyodSheet which only treats explicit selections as set).
 */
function ExtrasRow({
  component, selection, disabled, onOpen, onClear,
}: {
  component: StepComponent;
  selection: ComponentSelection | undefined;
  disabled: boolean;
  onOpen: () => void;
  onClear: (e: React.MouseEvent) => void;
}) {
  const isSet = !!selection;
  const chosenOpt = component.options.find((o) => o.id === selection?.variationId);
  const chosenSub = chosenOpt?.subOptions?.find((s) => s.id === selection?.variationTypeId);
  // Show a preview image even when unset: the chosen option's asset if set,
  // otherwise the first option's asset (so every row has an image, not a letter).
  const thumbUrl = chosenOpt?.assetUrl ?? component.options[0]?.assetUrl;
  // For toggles with no options, there's no thumbnail — use a leading icon-ish dot.
  const valueText = component.kind === "toggle"
    ? "On"
    : chosenOpt
      ? (chosenSub ? `${chosenOpt.label} · ${chosenSub.label}` : chosenOpt.label)
      : "Optional";
  const placeText = selection?.placement ? placementLabel(selection.placement) : null;

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onOpen}
      className={"group flex w-full items-center gap-3 rounded-card border bg-chalk-white p-2.5 text-left shadow-card transition-all ease-brand active:scale-[0.99] disabled:opacity-50 " +
        (isSet ? "border-accent-text/40" : "border-hairline hover:border-navy-interactive hover:shadow-brand")}
    >
      {/* Thumbnail / placeholder */}
      <div className="relative aspect-square w-12 shrink-0 overflow-hidden rounded-card bg-mist-navy">
        {thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            {component.kind === "toggle" ? (
              <Plus size={18} className="text-navy-interactive/40" />
            ) : (
              <span className="font-heading text-h3 font-bold text-navy-interactive/25">
                {component.label.charAt(0).toUpperCase()}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Label + value */}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-body font-semibold leading-tight text-ink-navy">{component.label}</span>
        <span className={"truncate text-caption leading-snug " + (isSet ? "text-accent-text" : "text-muted")}>
          {valueText}{placeText ? ` · ${placeText}` : ""}
        </span>
      </div>

      {/* Clear (only when set) */}
      {isSet && (
        <span
          role="button"
          tabIndex={0}
          onClick={onClear}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClear(e as unknown as React.MouseEvent); } }}
          aria-label={`Clear ${component.label}`}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-mist-navy hover:text-ink-navy"
        >
          <Close size={14} />
        </span>
      )}

      <ChevronRight size={18} className={"shrink-0 transition-transform " + (isSet ? "text-accent-text" : "text-muted")} />
    </button>
  );
}

/**
 * The picker that lives inside the bottom sheet. Holds a LOCAL draft of the
 * selection (variation + sub-type + placement) so the user can set multiple
 * axes (e.g. Keyhole shape + placement) before committing. Nothing is applied
 * to the live design until Confirm — on confirm, `onConfirm(draft)` fires once
 * and the sheet closes.
 */
function ExtrasPicker({
  component, initialSelection, disabled, onConfirm,
}: {
  component: StepComponent;
  initialSelection: ComponentSelection | undefined;
  disabled: boolean;
  onConfirm: (sel: ComponentSelection | null) => void;
}) {
  // Draft state — seeded from the current selection (or component defaults).
  const isToggle = component.kind === "toggle" || component.options.length === 0;
  const hasPlacement = !!component.placements && component.placements.length > 0;

  const [draft, setDraft] = useState<ComponentSelection | null>(
    initialSelection
      ? { ...initialSelection }
      : isToggle
        ? hasPlacement
          ? { variationId: "__toggle_on__", placement: component.placements![0] }
          : { variationId: "__toggle_on__" }
        : null,
  );

  // For toggle add-ons there are no option cards — just enable/disable + place.
  if (isToggle) {
    const on = !!draft;
    const keepPlacement = draft?.placement ?? component.placements?.[0];
    return (
      <>
        <div className="flex flex-col gap-3 py-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() => setDraft(on ? null : { variationId: "__toggle_on__", placement: keepPlacement })}
            className={"flex items-center justify-between gap-3 rounded-card border bg-chalk-white p-3 text-left shadow-card transition-all ease-brand active:scale-[0.99] disabled:opacity-50 " +
              (on ? "border-accent-text/40" : "border-hairline")}
          >
            <span className="text-body font-semibold text-ink-navy">{on ? "Enabled" : `Enable ${component.label}`}</span>
            <span
              aria-hidden
              className="relative h-6 w-11 shrink-0 rounded-pill transition-colors ease-brand"
              style={on ? { backgroundImage: "var(--tape-gradient)" } : { backgroundColor: "var(--tape-silver)" }}
            >
              <span className={"absolute top-0.5 h-5 w-5 rounded-full bg-chalk-white shadow transition-all ease-brand " + (on ? "left-[22px]" : "left-0.5")} />
            </span>
          </button>
          {component.description && (
            <p className="px-1 text-caption leading-snug text-muted">{component.description}</p>
          )}
        </div>
        <PickerFooter
          canConfirm
          onConfirm={() => onConfirm(draft)}
          confirmLabel={on ? strings.myod.done : "Skip"}
          placementProps={
            on && hasPlacement
              ? {
                  placements: component.placements!,
                  value: draft?.placement,
                  onSelect: (p: string) => setDraft((d) => d ? { ...d, placement: p } : { variationId: "__toggle_on__", placement: p }),
                  disabled,
                }
              : undefined
          }
        />
      </>
    );
  }

  // Choice component: image cards + optional sub-type chips + optional placement.
  const selectedId = draft?.variationId;
  const selectedOpt = component.options.find((o) => o.id === selectedId);
  const hasSubs = !!selectedOpt?.subOptions && selectedOpt.subOptions.length > 0;
  const canConfirm = !!draft;

  return (
    <>
      <div className="flex flex-col gap-2.5 py-2">
        {component.options.map((opt) => {
          const selected = opt.id === selectedId;
          return (
            <div
              key={opt.id}
              className={"group relative flex w-full flex-row items-stretch overflow-hidden rounded-card border text-left transition-all ease-brand disabled:opacity-50 " +
                (selected
                  ? "border-accent-text bg-chalk-white shadow-card"
                  : "border-hairline bg-chalk-white shadow-card hover:border-navy-interactive hover:shadow-brand")}
            >
              {selected && (
                <span
                  aria-hidden
                  className="absolute right-2 top-2 z-10 flex h-5 w-5 items-center justify-center rounded-full text-chalk-white shadow-[0_1px_2px_rgba(208,96,16,0.3)]"
                  style={{ backgroundImage: "var(--tape-gradient)" }}
                >
                  <Check size={12} />
                </span>
              )}
              <button
                type="button"
                disabled={disabled}
                onClick={() =>
                  setDraft({
                    variationId: opt.id,
                    // Keep existing sub-type if still valid for this option, else default/first.
                    variationTypeId: opt.subOptions?.find((s) => s.id === draft?.variationTypeId)?.id
                      ?? opt.defaultSubOptionId
                      ?? opt.subOptions?.[0]?.id,
                    placement: draft?.placement,
                  })
                }
                className="flex w-full flex-row items-stretch text-left active:scale-[0.99]"
              >
                {/* Reference image — left */}
                <div className="relative aspect-square w-24 shrink-0 overflow-hidden bg-mist-navy">
                  {opt.assetUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={opt.assetUrl} alt="" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <span className="font-heading text-h2 font-bold text-navy-interactive/25">
                        {opt.label.charAt(0).toUpperCase()}
                      </span>
                    </div>
                  )}
                </div>
                {/* Label + description — right */}
                <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 px-3 py-2">
                  <span className="text-body font-semibold leading-tight text-ink-navy">{opt.label}</span>
                  {opt.description && (
                    <span className="line-clamp-3 text-caption leading-snug text-muted">{opt.description}</span>
                  )}
                </div>
              </button>

              {/* Sub-type chips */}
              <AnimatePresence initial={false}>
                {selected && hasSubs && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                    className="flex flex-wrap gap-1.5 overflow-hidden border-t border-hairline px-3 py-2.5"
                  >
                    {selectedOpt!.subOptions!.map((sub) => {
                      const subSelected = sub.id === draft?.variationTypeId;
                      return (
                        <button
                          key={sub.id}
                          type="button"
                          disabled={disabled}
                          onClick={() => setDraft((d) => d ? { ...d, variationId: opt.id, variationTypeId: sub.id } : { variationId: opt.id, variationTypeId: sub.id, placement: draft?.placement })}
                          className={"rounded-pill border px-2.5 py-1 text-caption leading-tight transition-all ease-brand active:scale-[0.97] disabled:opacity-50 " +
                            (subSelected
                              ? "border-transparent bg-tape text-chalk-white"
                              : "border-hairline-strong bg-chalk-white text-ink hover:border-navy-interactive")}
                          style={subSelected ? { backgroundImage: "var(--tape-gradient)" } : undefined}
                        >
                          {sub.label}
                        </button>
                      );
                    })}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
      <PickerFooter
        canConfirm={canConfirm}
        onConfirm={() => onConfirm(draft)}
        confirmLabel={strings.myod.done}
        placementProps={
          hasPlacement && draft
            ? {
                placements: component.placements!,
                value: draft.placement,
                onSelect: (p: string) => setDraft((d) => d ? { ...d, placement: p } : { variationId: "__placement__", placement: p }),
                disabled,
              }
            : undefined
        }
      />
    </>
  );
}

/**
 * Sticky footer shared by all pickers: optional "Place on" segmented control +
 * a tape-gradient Confirm button. Renders outside the scroll area so it stays
 * visible while the user browses options.
 */
function PickerFooter({
  canConfirm, onConfirm, confirmLabel, placementProps,
}: {
  canConfirm: boolean;
  onConfirm: () => void;
  confirmLabel: string;
  placementProps?: {
    placements: string[];
    value?: string;
    onSelect: (p: string) => void;
    disabled: boolean;
  };
}) {
  return (
    // Sticky inside the sheet's scroll area so it stays visible while the user
    // browses option cards above. Mimics the BottomSheet footer slot styling.
    <div className="sticky bottom-0 -mx-4 mt-2 border-t border-hairline bg-chalk-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
      {placementProps && (
        <div className="flex flex-wrap items-center gap-1.5 pb-3">
          <span className="self-center font-mono text-[10px] uppercase tracking-[0.16em] text-muted">Place on</span>
          {placementProps.placements.map((p) => {
            const sel = placementProps.value === p;
            return (
              <button
                key={p}
                type="button"
                disabled={placementProps.disabled}
                onClick={() => placementProps.onSelect(p)}
                className={"rounded-pill border px-2.5 py-1 text-caption leading-tight transition-all ease-brand active:scale-[0.97] disabled:opacity-50 " +
                  (sel
                    ? "border-transparent bg-tape text-chalk-white"
                    : "border-hairline-strong bg-chalk-white text-ink hover:border-navy-interactive")}
                style={sel ? { backgroundImage: "var(--tape-gradient)" } : undefined}
              >
                {placementLabel(p)}
              </button>
            );
          })}
        </div>
      )}
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={onConfirm}
          disabled={!canConfirm}
          className="rounded-pill bg-tape px-5 py-2.5 text-body font-semibold text-chalk-white shadow-primary transition-all ease-brand hover:brightness-105 active:scale-[0.98] disabled:opacity-50"
          style={{ backgroundImage: "var(--tape-gradient)" }}
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}

function ToggleCard({
  component, showLabel, selection, disabled, onSelect,
}: {
  component: { id: string; label: string; kind?: "choice" | "toggle" };
  showLabel: boolean; selection: ComponentSelection | undefined;
  disabled: boolean; onSelect: (sel: ComponentSelection | null) => void;
}) {
  const on = !!selection && selection.variationId === "__toggle_on__";
  return (
    <div>
      {showLabel && <p className="mb-1.5 px-1 font-mono text-eyebrow font-medium uppercase tracking-[0.18em] text-muted">{component.label}</p>}
      <button type="button" disabled={disabled}
        onClick={() => onSelect(on ? null : { variationId: "__toggle_on__" })}
        className="flex w-full items-center justify-between gap-2 rounded-card border border-hairline bg-chalk-white px-3 py-2.5 text-left shadow-card transition-all ease-brand active:scale-[0.99] disabled:opacity-50">
        <span className="text-caption font-medium text-ink-navy">{component.label}</span>
        <span aria-hidden className={"relative h-5 w-9 shrink-0 rounded-pill transition-colors " + (on ? "bg-tape" : "bg-tape-silver")}
          style={on ? { backgroundImage: "var(--tape-gradient)" } : undefined}>
          <span className={"absolute top-0.5 h-4 w-4 rounded-full bg-chalk-white shadow transition-all " + (on ? "left-[18px]" : "left-0.5")} />
        </span>
      </button>
    </div>
  );
}

function ComponentCards({
  component, showLabel, selection, disabled, onSelect,
}: {
  component: { id: string; label: string; options: StepOption[]; kind?: "choice" | "toggle" };
  showLabel: boolean; selection: ComponentSelection | undefined;
  disabled: boolean; onSelect: (sel: ComponentSelection) => void;
}) {
  const selectedId = selection?.variationId;
  const [expandedId, setExpandedId] = useState<string | null>(selectedId ?? null);
  // When the expanded option has sub-types, its card body swaps to a chip group.
  const expandedOption = component.options.find((o) => o.id === expandedId);
  const chipsActive = !!expandedOption?.subOptions && expandedOption.subOptions.length > 0;

  if (component.kind === "toggle") {
    return <ToggleCard component={component} showLabel={showLabel} selection={selection} disabled={disabled} onSelect={onSelect as (sel: ComponentSelection | null) => void} />;
  }
  return (
    <div>
      {showLabel && <p className="mb-1.5 px-1 font-mono text-eyebrow font-medium uppercase tracking-[0.18em] text-muted">{component.label}</p>}
      <div className="flex flex-col gap-2">
        {component.options.map((opt) => {
          const selected = opt.id === selectedId;
          const expanded = opt.id === expandedId;
          // This card's body becomes chips when it is the active sub-type card.
          const showChipsHere = expanded && !!opt.subOptions && opt.subOptions.length > 0;
          return (
            <div
              key={opt.id}
              className={"group relative flex w-full flex-row items-stretch overflow-hidden rounded-card border text-left transition-all ease-brand disabled:opacity-50 " +
                (selected || expanded
                  ? "border-accent-text bg-chalk-white shadow-card"
                  : "border-hairline bg-chalk-white shadow-card hover:border-navy-interactive hover:shadow-brand")}
            >
              {selected && <span aria-hidden className="absolute right-2 top-2 z-10 h-2 w-2 rounded-full bg-draep-orange shadow-[0_0_0_2px_rgba(248,144,16,0.22)]" />}

              <AnimatePresence mode="wait" initial={false}>
                {showChipsHere ? (
                  // ── Chip body: replaces image + description, hugs the card frame ──
                  <motion.div
                    key="chips"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.18 }}
                    className="flex min-w-0 flex-1 flex-col gap-1.5 px-3 py-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-body font-semibold leading-tight text-ink-navy">{opt.label}</span>
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => setExpandedId(null)}
                        className="rounded-pill border border-hairline bg-chalk-white px-2 py-0.5 text-[10px] text-muted transition-colors hover:border-navy-interactive hover:text-ink-navy"
                        aria-label={`Back to ${opt.label}`}
                      >
                        Back
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {opt.subOptions!.map((sub) => {
                        const subSelected = selected && sub.id === selection?.variationTypeId;
                        return (
                          <button
                            key={sub.id}
                            type="button"
                            disabled={disabled}
                            onClick={() =>
                              onSelect({ variationId: opt.id, variationTypeId: sub.id })
                            }
                            className={
                              "rounded-pill border px-2.5 py-1 text-[12px] leading-tight transition-all active:scale-[0.97] disabled:opacity-50 " +
                              (subSelected
                                ? "border-accent-text bg-mist-navy text-ink-navy"
                                : "border-hairline bg-chalk-white text-muted hover:border-navy-interactive")
                            }
                          >
                            {sub.label}
                          </button>
                        );
                      })}
                    </div>
                  </motion.div>
                ) : (
                  // ── Default body: image + label + description (button) ──
                  <motion.button
                    key="body"
                    type="button"
                    disabled={disabled}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.18 }}
                    onClick={() => {
                      setExpandedId(opt.id);
                      if (!opt.subOptions || opt.subOptions.length === 0) {
                        onSelect({ variationId: opt.id });
                      }
                    }}
                    className="flex w-full flex-row items-stretch text-left active:scale-[0.99]"
                  >
                    {/* Reference image — left */}
                    <div className="relative aspect-square w-20 shrink-0 overflow-hidden bg-mist-navy">
                      {opt.assetUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={opt.assetUrl}
                          alt=""
                          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          <span className="font-heading text-h2 font-bold text-navy-interactive/25">
                            {opt.label.charAt(0).toUpperCase()}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Label + description — right */}
                    <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 px-3 py-2">
                      <span className="text-body font-semibold leading-tight text-ink-navy">{opt.label}</span>
                      {opt.description && (
                        <span className="line-clamp-3 text-caption leading-snug text-muted">{opt.description}</span>
                      )}
                    </div>
                  </motion.button>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ============================================================ */
/*  Loading / generating / error                                */
/* ============================================================ */

function GeneratingLoader() {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="relative flex flex-col items-center gap-4">
      <div className="relative flex h-28 w-28 items-center justify-center">
        <motion.div aria-hidden className="absolute inset-0 rounded-full bg-draep-orange/15 blur-3xl"
          animate={{ opacity: [0.5, 0.85, 0.5] }} transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }} />
        <motion.div aria-hidden className="absolute inset-7 rounded-full opacity-95"
          style={{ backgroundImage: "var(--tape-gradient)" }}
          animate={{ scale: [1, 1.12, 1], opacity: [0.85, 1, 0.85] }} transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }} />
        {[0, 1, 2].map((i) => (
          <motion.div key={i} aria-hidden className="absolute h-2.5 w-2.5 rounded-full bg-chalk-white shadow"
            style={{ offsetPath: "path('M 56 14 A 42 42 0 1 1 55.9 14 Z')" }}
            animate={{ offsetDistance: ["0%", "100%"] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: "linear", delay: i * 0.73 }} />
        ))}
        <Sparkles size={24} className="relative z-10 text-chalk-white" />
      </div>
      <motion.p className="font-heading text-h3 font-semibold text-ink-navy"
        animate={{ opacity: [0.65, 1, 0.65] }} transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}>
        {strings.myod.generating}
      </motion.p>
      <div className="h-1.5 w-36 overflow-hidden rounded-pill bg-tape-silver">
        <div className="h-full rounded-full" style={{ width: "100%", transform: "scaleX(0)", transformOrigin: "left", backgroundImage: "var(--tape-gradient)", animation: "myod-progress-fill 60s linear forwards" }} />
      </div>
    </motion.div>
  );
}

function LoadingTree() {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="flex h-[40vh] flex-col items-center justify-center gap-3 text-muted">
      <motion.div className="h-10 w-10 rounded-full border-2 border-navy-interactive/30 border-t-navy-interactive"
        animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }} />
      <p className="text-caption">{strings.myod.loadingTree}</p>
    </motion.div>
  );
}

function ErrorStage({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.25 }} className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-error-bg text-error-text"><Close size={22} /></div>
      <p className="font-heading text-h3 font-semibold text-ink-navy">{strings.myod.errorTitle}</p>
      <p className="text-body text-muted">{message}</p>
      <button type="button" onClick={onRetry}
        className="mt-1 rounded-pill bg-tape px-5 py-2.5 text-body font-semibold text-chalk-white shadow-primary transition-all hover:brightness-105 active:scale-[0.98]"
        style={{ backgroundImage: "var(--tape-gradient)" }}>
        {strings.myod.errorRetry}
      </button>
    </motion.div>
  );
}

export { labelText };
