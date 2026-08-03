"use client";

/**
 * MyodSheet — "Make Your Own Draep", full-page, one step at a time.
 *
 *   • Opens showing the DEFAULT blouse photo (the garment's asset_urls[0]) —
 *     instant, no generation on load.
 *   • Shows ONE step at a time: the current step's option cards, plus a
 *     chat + mic bar below. Selecting an option (or a sub-option / variation
 *     type) or sending a chat edit regenerates the image ONLY if it actually
 *     differs from what the current image already depicts — otherwise it's a
 *     no-op (no wasted Gemini call). After an option refine, auto-advance to
 *     the next step; chat stays put.
 *   • "Try it on" sits top-right.
 *
 * Image-state tracking: `imageSelections` records what the current image
 * depicts (initialized to the catalog defaults, since the default asset is the
 * default blouse). A refine is skipped whenever the requested selections equal
 * `imageSelections` (deep, including sub-types). On each successful refine,
 * `imageSelections` is updated to what was sent.
 */

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Sparkles, Close } from "@/components/ui/icons";
import { getGarmentTree, listGarments } from "@/lib/api/catalog";
import { blouseJsCode, blouseSvg, refineBlouse } from "@/lib/api/myod";
import {
  buildDesignBrief,
  buildDesignSteps,
  buildSvgState,
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
import { useJsSvg } from "@/hooks/useJsSvg";
import type { GarmentTreeOut } from "@/types/api";

type Phase = "loading-tree" | "ready" | "generating" | "error";

interface Props {
  /** Called when the user taps "Try it on" — receives the current garment image. */
  onTryItOn: (garmentImage: string) => void;
}

export function MyodSheet({ onTryItOn }: Props) {
  const [phase, setPhase] = useState<Phase>("loading-tree");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [tree, setTree] = useState<GarmentTreeOut | null>(null);
  const steps = useMemo(() => (tree ? buildDesignSteps(tree) : []), [tree]);

  const [activeStepIdx, setActiveStepIdx] = useState(0);
  const [selections, setSelections] = useState<Selections>({});

  // The current image and the selections it depicts.
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageSelections, setImageSelections] = useState<Selections>({});
  const genTokenRef = useRef(0);

  // EXPERIMENT: SVG render mode. Two sub-modes:
  //  - "svg"       : regenerate SVG from the brief each step (LLM per step)
  //  - "svg-code"  : generate a Python fn ONCE, run it in Pyodide per step (fast)
  const [renderMode, setRenderMode] = useState<"image" | "svg" | "svg-code">("image");
  const [svgMarkup, setSvgMarkup] = useState<string | null>(null);
  const jsSvg = useJsSvg();
  const [jsFnReady, setJsFnReady] = useState(false);

  const [chatInput, setChatInput] = useState("");
  const [chatError, setChatError] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<unknown>(null);

  // Remember the last applied change so a failed refine can be retried.
  const lastChangeRef = useRef<{ change: string; selections: Selections } | null>(null);

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
        // Start with NO selection (user chooses). The image begins as the
        // pre-generated default, which depicts the catalog defaults — so
        // imageSelections is seeded with those defaults.
        const built = buildDesignSteps(t);
        setSelections({});
        setImageSelections(defaultSelections(built));
        setActiveStepIdx(0);
        setImageUrl(t.asset_urls?.[0] ?? null);
        setPhase("ready");
        track({ event: "myod_opened", source: "library" });
      } catch (err) {
        if (cancelled) return;
        setErrorMsg(err instanceof Error ? err.message : "Couldn't load the design options.");
        setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const activeStep: DesignStep | undefined = steps[activeStepIdx];

  // IDs of boolean-toggle components (add-ons with no variations). Used by the
  // skip-refine check so toggling on↔off is always detected as a change.
  const toggleIds = useMemo(
    () =>
      new Set(
        steps
          .flatMap((s) => s.components)
          .filter((c) => c.kind === "toggle")
          .map((c) => c.id),
      ),
    [steps],
  );

  // ── Apply a change: refine the image, OR regenerate the SVG ─────────
  const applyChange = useCallback(
    async (changeDescription: string, allSelections: Selections) => {
      // SVG-CODE mode: generate a JS renderer fn once, then run it natively
      // per step (microseconds). The expensive LLM call happens only the first
      // time (or if the fn isn't ready). Dynamic — the fn reads the live
      // catalog state, so newly added components are handled automatically.
      if (renderMode === "svg-code") {
        const token = ++genTokenRef.current;
        setChatError(false);
        setPhase("generating");
        lastChangeRef.current = { change: changeDescription, selections: allSelections };
        try {
          if (!jsFnReady) {
            const brief = buildDesignBrief(steps, allSelections);
            const { code } = await blouseJsCode(brief, tree?.id);
            await jsSvg.defineFn(code);
            setJsFnReady(true);
          }
          const state = buildSvgState(steps, allSelections);
          const svg = await jsSvg.renderSvg(state);
          if (token !== genTokenRef.current) return;
          setSvgMarkup(svg);
          setImageSelections(allSelections);
          setPhase("ready");
          track({ event: "myod_succeeded" });
        } catch (err) {
          if (token !== genTokenRef.current) return;
          setChatError(true);
          setErrorMsg(err instanceof Error ? err.message : "Something went wrong.");
          setPhase("ready");
          track({ event: "myod_failed", error: err instanceof Error ? err.message : undefined });
        }
        return;
      }

      // SVG mode: regenerate the vector drawing from the full brief each step
      // (no image-to-image; the SVG is rebuilt from scratch each step).
      if (renderMode === "svg") {
        const token = ++genTokenRef.current;
        setChatError(false);
        setPhase("generating");
        lastChangeRef.current = { change: changeDescription, selections: allSelections };
        const brief = buildDesignBrief(steps, allSelections);
        try {
          const result = await blouseSvg(brief, tree?.id);
          if (token !== genTokenRef.current) return;
          setSvgMarkup(result.svg);
          setImageSelections(allSelections);
          setPhase("ready");
          track({ event: "myod_succeeded" });
        } catch (err) {
          if (token !== genTokenRef.current) return;
          setChatError(true);
          setErrorMsg(err instanceof Error ? err.message : "Something went wrong.");
          setPhase("ready");
          track({ event: "myod_failed", error: err instanceof Error ? err.message : undefined });
        }
        return;
      }

      if (!imageUrl) return;
      const token = ++genTokenRef.current;
      setChatError(false);
      setPhase("generating");
      lastChangeRef.current = { change: changeDescription, selections: allSelections };

      const brief = buildDesignBrief(steps, allSelections);
      try {
        const result = await refineBlouse(imageUrl, brief, changeDescription, tree?.id);
        if (token !== genTokenRef.current) return; // superseded
        setImageUrl(result.output_url);
        // The image now depicts the sent selections overlaid on whatever it
        // showed before (defaults for unchosen choice-components). For toggles,
        // the sent state is authoritative — a toggle turned off (absent) must
        // be removed from the tracked image state, not kept from the past.
        setImageSelections((prev) => {
          const merged: Selections = { ...prev, ...allSelections };
          for (const id of toggleIds) {
            if (!(id in allSelections)) delete merged[id];
          }
          return merged;
        });
        setPhase("ready");
        track({ event: "myod_succeeded" });
      } catch (err) {
        if (token !== genTokenRef.current) return;
        setChatError(true);
        setErrorMsg(err instanceof Error ? err.message : "Something went wrong.");
        setPhase("ready");
        track({ event: "myod_failed", error: err instanceof Error ? err.message : undefined });
      }
    },
    [imageUrl, steps, tree?.id, toggleIds, renderMode, jsFnReady, jsSvg],
  );

  const retryLast = useCallback(() => {
    const last = lastChangeRef.current;
    if (last) void applyChange(last.change, last.selections);
  }, [applyChange]);

  // ── Option / sub-option tap: refine only if it differs, then advance ─
  const handleSelectOption = useCallback(
    (componentId: string, sel: ComponentSelection | null) => {
      // sel === null means "turn off" (a boolean toggle). Drop the component.
      const next = { ...selections };
      if (sel) next[componentId] = sel;
      else delete next[componentId];
      setSelections(next);

      // On the merged "extras" step, selecting an option never auto-advances —
      // the user picks several fit/detail/add-on choices, then moves on.
      const step = steps[activeStepIdx];
      const shouldAdvance = !step?.isExtras;
      const advance = () => {
        if (shouldAdvance) setActiveStepIdx((i) => Math.min(steps.length - 1, i + 1));
      };

      // Skip the Gemini call if the requested state already matches what the
      // image depicts. Choice components only compare when selected; toggles
      // compare symmetrically (on↔off is a change).
      if (selectionMatchesImage(next, imageSelections, toggleIds)) {
        advance();
        return;
      }

      const change = sel
        ? step
          ? describeSelection(step, componentId, sel)
          : ""
        : `${step?.components.find((c) => c.id === componentId)?.label ?? "Add-on"} → off`;
      track({ event: "myod_refined", instruction: change });
      void applyChange(change, next).then(advance);
    },
    [selections, imageSelections, steps, activeStepIdx, applyChange, toggleIds],
  );

  // ── Chat: free-text edit, stay on current step ──────────────────────
  const handleSendChat = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = chatInput.trim();
      if (!trimmed) return;
      track({ event: "myod_refined", instruction: trimmed });
      void applyChange(trimmed, selections);
      setChatInput("");
    },
    [chatInput, selections, applyChange],
  );

  const handleMicToggle = useMicToggle({
    listening,
    setListening,
    recognitionRef,
    onTranscript: (t) => setChatInput((prev) => (prev.trim() ? `${prev} ${t}` : t)),
  });

  useEffect(() => {
    const ref = recognitionRef;
    return () => {
      (ref.current as { stop: () => void } | null)?.stop();
    };
  }, []);

  const handleTryItOn = useCallback(() => {
    if (!imageUrl) return;
    track({ event: "myod_tried_on" });
    onTryItOn(imageUrl);
  }, [imageUrl, onTryItOn]);

  const retry = useCallback(() => {
    setErrorMsg(null);
    setPhase("ready");
  }, []);

  // Switch render mode. Going to SVG triggers an immediate SVG generation from
  // the current selections (treating unchosen as defaults via imageSelections).
  const switchRenderMode = useCallback(
    (mode: "image" | "svg" | "svg-code") => {
      if (mode === renderMode) return;
      setRenderMode(mode);
      if (mode === "svg" || mode === "svg-code") {
        // Generate an SVG (or the renderer fn) from the current effective state.
        const effective = Object.keys(selections).length ? selections : imageSelections;
        void applyChange("switch to vector view", effective);
      }
    },
    [renderMode, selections, imageSelections, applyChange],
  );

  return (
    <div className="relative mx-auto flex w-full max-w-column flex-col gap-4 px-4 pb-6">
      {/* Try it on + render-mode toggle — top right (sticky). */}
      <div className="pointer-events-none sticky top-2 z-20 -mb-2 flex items-start justify-end gap-2">
        {/* EXPERIMENT: render-mode segmented toggle (Photo / Vector / Vector fn) */}
        <div className="pointer-events-auto flex items-center rounded-pill border border-hairline-strong bg-chalk-white/90 p-0.5 shadow-card backdrop-blur">
          {(["image", "svg", "svg-code"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => switchRenderMode(m)}
              disabled={phase === "generating"}
              className={
                "rounded-pill px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide transition-all disabled:opacity-50 " +
                (renderMode === m
                  ? "bg-tape text-chalk-white"
                  : "text-muted hover:text-ink-navy")
              }
              style={renderMode === m ? { backgroundImage: "var(--tape-gradient)" } : undefined}
            >
              {m === "image" ? "Photo" : m === "svg" ? "Vector" : "Vector fn"}
            </button>
          ))}
        </div>
        {imageUrl && renderMode === "image" && (
          <button
            type="button"
            onClick={handleTryItOn}
            disabled={phase === "generating"}
            className="pointer-events-auto flex items-center gap-1 rounded-pill bg-tape px-3.5 py-1.5 text-caption font-semibold text-chalk-white shadow-primary transition-all ease-brand hover:brightness-105 active:scale-[0.98] disabled:opacity-50"
            style={{ backgroundImage: "var(--tape-gradient)" }}
          >
            <Sparkles size={13} />
            {strings.myod.tryOnCta}
          </button>
        )}
      </div>

      <AnimatePresence mode="wait">
        {phase === "loading-tree" && <LoadingTree key="lt" />}
        {phase === "error" && !imageUrl && (
          <ErrorStage key="err" message={errorMsg ?? "Something went wrong."} onRetry={retry} />
        )}
        {phase !== "loading-tree" && !(phase === "error" && !imageUrl) && (
          <motion.div
            key="main"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col gap-4"
          >
            <ImageStage
              imageUrl={imageUrl}
              generating={phase === "generating"}
              renderMode={renderMode}
              svgMarkup={svgMarkup}
            />

            {activeStep && (
              <StepCards
                step={activeStep}
                selections={selections}
                disabled={phase === "generating"}
                onSelect={handleSelectOption}
              />
            )}

            {chatError && (
              <div className="flex items-center justify-between gap-2 rounded-card border border-error-border bg-error-bg px-3 py-2">
                <p className="text-caption text-error-text">
                  {errorMsg ?? strings.myod.chatError}
                </p>
                <button
                  type="button"
                  onClick={retryLast}
                  className="shrink-0 rounded-pill border border-error-border bg-chalk-white px-3 py-1 text-[12px] font-semibold text-error-text transition-all active:scale-[0.97]"
                >
                  {strings.myod.errorRetry}
                </button>
              </div>
            )}

            <ChatBar
              value={chatInput}
              onChange={(v) => {
                setChatInput(v);
                setChatError(false);
              }}
              onSubmit={handleSendChat}
              onMic={handleMicToggle}
              listening={listening}
              disabled={phase === "generating"}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Default selections (what the default asset image depicts) ──────────

function defaultSelections(steps: DesignStep[]): Selections {
  const out: Selections = {};
  for (const step of steps) {
    for (const comp of step.components) {
      // Boolean toggles: seeded ON only if defaultOn (absent = off).
      if (comp.kind === "toggle") {
        if (comp.defaultOn) out[comp.id] = { variationId: TOGGLE_ON };
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

/** Sentinel variationId marking a boolean toggle as ON (absent = OFF). */
const TOGGLE_ON = "__toggle_on__";

/* ============================================================ */
/*  Mic hook                                                    */
/* ============================================================ */

function useMicToggle(opts: {
  listening: boolean;
  setListening: (v: boolean) => void;
  recognitionRef: React.MutableRefObject<unknown>;
  onTranscript: (text: string) => void;
}) {
  const { listening, setListening, recognitionRef, onTranscript } = opts;
  return useCallback(() => {
    if (listening) {
      (recognitionRef.current as { stop: () => void } | null)?.stop();
      return;
    }
    const SR =
      (typeof window !== "undefined" &&
        ((window as unknown as Record<string, unknown>).SpeechRecognition ||
          (window as unknown as Record<string, unknown>).webkitSpeechRecognition)) ||
      null;
    if (!SR) return;

    const recognition = new (SR as new () => {
      lang: string;
      interimResults: boolean;
      maxAlternatives: number;
      onresult: (event: { results: { 0?: { 0?: { transcript?: string } } } }) => void;
      onerror: () => void;
      onend: () => void;
      start: () => void;
      stop: () => void;
    })();
    recognition.lang = "en-IN";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript ?? "";
      if (transcript) onTranscript(transcript);
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }, [listening, setListening, recognitionRef, onTranscript]);
}

/* ============================================================ */
/*  Image stage                                                 */
/* ============================================================ */

function ImageStage({
  imageUrl,
  generating,
  renderMode,
  svgMarkup,
}: {
  imageUrl: string | null;
  generating: boolean;
  renderMode: "image" | "svg" | "svg-code";
  svgMarkup: string | null;
}) {
  // In either SVG mode, the "content" is the SVG markup; else the image URL.
  const isSvg = renderMode !== "image";
  const hasContent = isSvg ? !!svgMarkup : !!imageUrl;
  return (
    <div className="relative overflow-hidden rounded-card border border-hairline bg-mist-navy">
      <AnimatePresence mode="wait">
        {hasContent && !generating ? (
          isSvg && svgMarkup ? (
            <motion.div
              key={svgMarkup.slice(0, 40)}
              className="mx-auto flex h-[44vh] w-full items-center justify-center p-4 [&_svg]:h-full [&_svg]:max-h-full [&_svg]:w-auto"
              initial={{ opacity: 0.4, scale: 1.04 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              // eslint-disable-next-line react/no-danger
              dangerouslySetInnerHTML={{ __html: svgMarkup }}
            />
          ) : (
            <motion.img
              key={imageUrl ?? ""}
              src={imageUrl ?? undefined}
              alt="Your MYOD blouse design"
              className="mx-auto block max-h-[44vh] w-auto max-w-full object-contain"
              initial={{ scale: 1.04, opacity: 0.4 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              // eslint-disable-next-line @next/next/no-img-element
            />
          )
        ) : (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex h-[44vh] items-center justify-center"
          >
            <GeneratingLoader />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="pointer-events-none absolute left-2 top-2 flex items-center gap-1 rounded-pill bg-ink-navy/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-chalk-white backdrop-blur-md">
        <Sparkles size={10} />
        {isSvg ? "AI vector" : "AI design"}
      </div>
    </div>
  );
}

/* ============================================================ */
/*  Step option cards                                           */
/* ============================================================ */

function StepCards({
  step,
  selections,
  disabled,
  onSelect,
}: {
  step: DesignStep;
  selections: Selections;
  disabled: boolean;
  onSelect: (componentId: string, sel: ComponentSelection | null) => void;
}) {
  return (
    <div>
      <div className="mb-3 px-1">
        <span className="eyebrow">{strings.myod.chooseEyebrow}</span>
        <p className="mt-1 font-heading text-h3 font-semibold leading-snug text-ink-navy">
          {step.title}
        </p>
        <div className="mt-2 flex items-center gap-2" aria-hidden>
          <span className="tick-divider flex-1" />
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-draep-orange shadow-[0_0_0_2px_rgba(248,144,16,0.22)]" />
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

/* ============================================================ */
/*  Extras list — grouped by section (Fit / Add-ons), inline    */
/*  variation types, placement picker for placement addons.     */
/* ============================================================ */

function ExtrasList({
  step,
  selections,
  disabled,
  onSelect,
}: {
  step: DesignStep;
  selections: Selections;
  disabled: boolean;
  onSelect: (componentId: string, sel: ComponentSelection | null) => void;
}) {
  // Group components by their `section` ("Fit" / "Add-ons"), preserving order.
  const sections: { name: string; components: typeof step.components }[] = [];
  for (const comp of step.components) {
    const name = comp.section ?? "Details";
    const existing = sections.find((s) => s.name === name);
    if (existing) existing.components.push(comp);
    else sections.push({ name, components: [comp] });
  }

  return (
    <div className="flex flex-col gap-5">
      {sections.map((sec, si) => (
        <div key={sec.name} className={si > 0 ? "pt-1" : ""}>
          {/* Section header */}
          <div className="mb-2.5 flex items-center gap-2">
            <span className="font-mono text-eyebrow font-medium uppercase tracking-[0.18em] text-accent-text">
              {sec.name}
            </span>
            <span className="tick-divider flex-1" aria-hidden />
          </div>

          {/* 2 columns — each component/add-on is one cell, compact inside. */}
          <div className="grid grid-cols-2 gap-2.5">
            {sec.components.map((comp) => (
              <ExtrasRow
                key={comp.id}
                component={comp}
                selection={selections[comp.id]}
                disabled={disabled}
                onSelect={(sel) => onSelect(comp.id, sel)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** One component in the extras list — vertical, with inline types + placement. */
function ExtrasRow({
  component,
  selection,
  disabled,
  onSelect,
}: {
  component: StepComponent;
  selection: ComponentSelection | undefined;
  disabled: boolean;
  onSelect: (sel: ComponentSelection | null) => void;
}) {
  const selectedId = selection?.variationId;

  // When the user taps a variation that HAS types, we don't commit yet — we
  // mark it "pending" so its type chips appear beneath it. Only tapping a type
  // (or a variation with no types) commits via onSelect → refine.
  const [pendingTypeId, setPendingTypeId] = useState<string | null>(
    selectedId ?? null,
  );

  // Boolean toggle.
  if (component.kind === "toggle") {
    return (
      <ToggleCard
        component={component}
        showLabel
        selection={selection}
        disabled={disabled}
        onSelect={onSelect}
      />
    );
  }

  const hasPlacement = !!component.placements && component.placements.length > 0;
  const placementActive = hasPlacement && !!selection;

  return (
    <div className="rounded-card border border-hairline bg-chalk-white p-2.5 shadow-card">
      <p className="mb-1.5 text-[12px] font-semibold leading-tight text-ink-navy">{component.label}</p>

      {/* Step 1 — variation dropdown. */}
      {component.options.length > 0 ? (
        <>
          <select
            disabled={disabled}
            value={pendingTypeId ?? ""}
            onChange={(e) => {
              const opt = component.options.find((o) => o.id === e.target.value);
              if (!opt) return;
              setPendingTypeId(opt.id);
              if (!opt.subOptions || opt.subOptions.length === 0) {
                // No types → commit immediately.
                onSelect({ variationId: opt.id, placement: selection?.placement });
              }
              // Has types → wait for Step 2 (no commit).
            }}
            className="w-full rounded-pill border border-hairline bg-chalk-white px-2.5 py-1.5 text-[12px] text-ink-navy focus:border-accent-text focus:outline-none disabled:opacity-50"
          >
            <option value="" disabled>
              Choose {component.label}…
            </option>
            {component.options.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>

          {/* Step 2 — type dropdown, only for the chosen variation if it has types. */}
          {(() => {
            const chosen = component.options.find((o) => o.id === pendingTypeId);
            if (!chosen?.subOptions || chosen.subOptions.length === 0) return null;
            const chosenType = selection?.variationTypeId;
            return (
              <div className="mt-1.5 flex items-center gap-1.5">
                <span className="shrink-0 text-[11px] font-medium text-muted">Type:</span>
                <select
                  disabled={disabled}
                  value={chosenType ?? ""}
                  onChange={(e) => {
                    const subId = e.target.value;
                    if (!subId) return;
                    setPendingTypeId(chosen.id);
                    onSelect({
                      variationId: chosen.id,
                      variationTypeId: subId,
                      placement: selection?.placement,
                    });
                  }}
                  className="min-w-0 flex-1 rounded-pill border border-hairline bg-chalk-white px-2 py-1 text-[11px] text-ink-navy focus:border-accent-text focus:outline-none disabled:opacity-50"
                >
                  <option value="" disabled>
                    Select type…
                  </option>
                  {chosen.subOptions.map((sub) => (
                    <option key={sub.id} value={sub.id}>
                      {sub.label}
                    </option>
                  ))}
                </select>
              </div>
            );
          })()}
        </>
      ) : (
        // No variations: placement-only addon (e.g. Net work) → single Add chip.
        hasPlacement && (
          <button
            type="button"
            disabled={disabled}
            onClick={() =>
              onSelect(
                placementActive
                  ? null
                  : { variationId: "__placement__", placement: component.placements![0] },
              )
            }
            className={
              "rounded-pill border px-2 py-0.5 text-[11px] leading-tight transition-all active:scale-[0.97] disabled:opacity-50 " +
              (placementActive
                ? "border-accent-text bg-mist-navy text-ink-navy"
                : "border-hairline bg-chalk-white text-muted hover:border-navy-interactive")
            }
          >
            {placementActive ? "Added" : "+ Add"}
          </button>
        )
      )}

      {/* Placement picker (Latkan, Key Hole, Net) */}
      <AnimatePresence>
        {hasPlacement && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-1.5 flex flex-wrap gap-1 overflow-hidden pl-0.5"
          >
            <span className="self-center text-[10px] text-muted">Place on:</span>
            {component.placements!.map((p) => {
              const pSelected = selection?.placement === p;
              return (
                <button
                  key={p}
                  type="button"
                  disabled={disabled || !placementActive}
                  onClick={() =>
                    onSelect({
                      variationId: selection?.variationId ?? "__placement__",
                      variationTypeId: selection?.variationTypeId,
                      placement: p,
                    })
                  }
                  className={
                    "rounded-pill border px-1.5 py-0.5 text-[10px] leading-tight transition-all active:scale-[0.97] disabled:opacity-40 " +
                    (pSelected
                      ? "border-accent-text bg-chalk-white text-ink-navy"
                      : "border-hairline bg-chalk-white text-muted hover:border-navy-interactive")
                  }
                >
                  {placementLabel(p)}
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ComponentCards({
  component,
  showLabel,
  compact = false,
  selection,
  disabled,
  onSelect,
}: {
  component: {
    id: string;
    label: string;
    options: StepOption[];
    kind?: "choice" | "toggle";
    description?: string;
  };
  showLabel: boolean;
  /** Dense layout: option chips wrap in a flex row instead of a 3-col grid. */
  compact?: boolean;
  selection: ComponentSelection | undefined;
  disabled: boolean;
  onSelect: (sel: ComponentSelection | null) => void;
}) {
  // Dispatch by kind so each branch owns its own hooks (rules-of-hooks).
  if (component.kind === "toggle") {
    return (
      <ToggleCard
        component={component}
        showLabel={showLabel}
        selection={selection}
        disabled={disabled}
        onSelect={onSelect}
      />
    );
  }
  return (
    <ChoiceCard
      component={component}
      showLabel={showLabel}
      compact={compact}
      selection={selection}
      disabled={disabled}
      onSelect={onSelect}
    />
  );
}

/* ─── Boolean toggle (add-on with no variations) ──────────────────────── */

function ToggleCard({
  component,
  showLabel,
  selection,
  disabled,
  onSelect,
}: {
  component: { id: string; label: string; kind?: "choice" | "toggle" };
  showLabel: boolean;
  selection: ComponentSelection | undefined;
  disabled: boolean;
  onSelect: (sel: ComponentSelection | null) => void;
}) {
  const on = !!selection && selection.variationId === TOGGLE_ON;
  return (
    <div>
      {showLabel && (
        <p className="mb-1.5 px-1 font-mono text-eyebrow font-medium uppercase tracking-[0.18em] text-muted">
          {component.label}
        </p>
      )}
      <button
        type="button"
        disabled={disabled}
        onClick={() => onSelect(on ? null : { variationId: TOGGLE_ON })}
        className="flex w-full items-center justify-between gap-2 rounded-card border border-hairline bg-chalk-white px-3 py-2.5 text-left shadow-card transition-all ease-brand active:scale-[0.99] disabled:opacity-50"
      >
        <span className="text-caption font-medium text-ink-navy">
          {component.label}
        </span>
        <span
          aria-hidden
          className={
            "relative h-5 w-9 shrink-0 rounded-pill transition-colors " +
            (on ? "bg-tape" : "bg-tape-silver")
          }
          style={on ? { backgroundImage: "var(--tape-gradient)" } : undefined}
        >
          <span
            className={
              "absolute top-0.5 h-4 w-4 rounded-full bg-chalk-white shadow transition-all " +
              (on ? "left-[18px]" : "left-0.5")
            }
          />
        </span>
      </button>
    </div>
  );
}

/* ─── Single choice (style component or add-on with variations) ───────── */

function ChoiceCard({
  component,
  showLabel,
  compact = false,
  selection,
  disabled,
  onSelect,
}: {
  component: { id: string; label: string; options: StepOption[] };
  showLabel: boolean;
  compact?: boolean;
  selection: ComponentSelection | undefined;
  disabled: boolean;
  onSelect: (sel: ComponentSelection) => void;
}) {
  // ── Single choice (style component or add-on with variations) ───────
  const selectedId = selection?.variationId;

  // Which variation is currently "expanded" (showing its type chips). Tapping a
  // variation WITH sub-options expands it instead of committing — the user
  // then taps a type, which commits. Tapping a variation WITHOUT sub-options
  // commits immediately.
  const [expandedId, setExpandedId] = useState<string | null>(
    selection?.variationId ?? null,
  );
  const selectedOption = component.options.find((o) => o.id === expandedId);

  return (
    <div>
      {showLabel && (
        <p className="mb-1.5 px-1 font-mono text-eyebrow font-medium uppercase tracking-[0.18em] text-muted">
          {component.label}
        </p>
      )}

      <div className={compact ? "flex flex-wrap gap-1.5" : "grid grid-cols-3 gap-2"}>
        {component.options.map((opt) => {
          const selected = opt.id === selectedId;
          const expanded = opt.id === expandedId;
          return (
            <button
              key={opt.id}
              type="button"
              disabled={disabled}
              onClick={() => {
                if (opt.subOptions && opt.subOptions.length > 0) {
                  // Has types → expand to reveal them (don't commit yet).
                  setExpandedId(opt.id);
                } else {
                  // No types → commit immediately.
                  setExpandedId(opt.id);
                  onSelect({ variationId: opt.id });
                }
              }}
              className={
                "relative flex flex-col items-center justify-center gap-1 rounded-card border px-2 py-3 text-center text-caption font-medium transition-all ease-brand active:scale-[0.97] disabled:opacity-50 " +
                (selected || expanded
                  ? "border-accent-text bg-chalk-white text-ink-navy shadow-card"
                  : "border-hairline bg-chalk-white text-ink-navy shadow-card hover:-translate-y-0.5 hover:border-navy-interactive hover:shadow-brand")
              }
            >
              {selected && (
                <span
                  aria-hidden
                  className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-draep-orange shadow-[0_0_0_2px_rgba(248,144,16,0.22)]"
                />
              )}
              <span className="leading-tight">{opt.label}</span>
            </button>
          );
        })}
      </div>

      {/* Sub-options (variation types) for the EXPANDED option. Picking a type
          commits the selection → the parent decides whether to refine. */}
      <AnimatePresence>
        {selectedOption?.subOptions && selectedOption.subOptions.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-2 flex flex-wrap gap-1.5 overflow-hidden"
          >
            {selectedOption.subOptions.map((sub) => {
              const subSelected = sub.id === selection?.variationTypeId;
              return (
                <button
                  key={sub.id}
                  type="button"
                  disabled={disabled}
                  onClick={() =>
                    onSelect({ variationId: selectedOption.id, variationTypeId: sub.id })
                  }
                  className={
                    "rounded-pill border px-2.5 py-1 text-[12px] transition-all active:scale-[0.97] disabled:opacity-50 " +
                    (subSelected
                      ? "border-accent-text bg-mist-navy text-ink-navy"
                      : "border-hairline bg-chalk-white text-muted hover:border-navy-interactive")
                  }
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
}

/* ============================================================ */
/*  Chat bar                                                    */
/* ============================================================ */

function ChatBar({
  value,
  onChange,
  onSubmit,
  onMic,
  listening,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onMic: () => void;
  listening: boolean;
  disabled: boolean;
}) {
  return (
    <form onSubmit={onSubmit} className="sticky bottom-0">
      <div className="flex items-center gap-1.5 rounded-card border border-hairline-strong bg-chalk-white p-1.5 shadow-card">
        <button
          type="button"
          onClick={onMic}
          aria-label={strings.myod.chatMic}
          className={
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors " +
            (listening ? "bg-error-bg text-error-text" : "text-muted hover:bg-mist-navy")
          }
        >
          <MicGlyph active={listening} />
        </button>

        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={listening ? strings.myod.chatListening : strings.myod.chatPlaceholder}
          disabled={disabled}
          className="min-w-0 flex-1 border-none bg-transparent text-body text-ink-navy placeholder:text-muted focus:outline-none disabled:opacity-50"
        />

        <button
          type="submit"
          disabled={!value.trim() || disabled}
          aria-label={strings.myod.chatSend}
          className="flex h-9 shrink-0 items-center gap-1 rounded-pill bg-tape px-3 text-caption font-semibold text-chalk-white transition-all hover:brightness-105 active:scale-[0.97] disabled:opacity-40"
          style={{ backgroundImage: "var(--tape-gradient)" }}
        >
          <SendGlyph />
          <span className="hidden xs:inline">{strings.myod.chatSend}</span>
        </button>
      </div>
    </form>
  );
}

/* ============================================================ */
/*  Loading states                                              */
/* ============================================================ */

/**
 * GeneratingLoader — a fashion artist sketching a blouse, with a timed
 * progress bar that fills over ~1 minute (the typical gpt-image-2 refine time).
 * The sketch strokes animate in via stroke-dashoffset; the pen hand sways.
 */
function GeneratingLoader() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex h-full w-full flex-col items-center justify-center gap-5 px-6"
    >
      {/* Sketching artist scene */}
      <div className="relative flex w-full max-w-[220px] flex-col items-center">
        {/* Premium spotlight glow behind the sketch */}
        <motion.div
          aria-hidden
          className="absolute -top-6 h-40 w-40 rounded-full bg-draep-orange/15 blur-3xl"
          animate={{ opacity: [0.5, 0.85, 0.5] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        />

        <svg viewBox="0 0 200 150" className="relative w-full" fill="none" aria-hidden>
          {/* The blouse being sketched — strokes draw in on a loop */}
          <motion.path
            d="M70 45 L60 70 L55 120 L80 125 L100 122 L120 125 L145 120 L140 70 L130 45
               C125 40 115 38 100 38 C85 38 75 40 70 45 Z"
            stroke="var(--ink-navy)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={{ pathLength: 0, opacity: 0.3 }}
            animate={{ pathLength: [0, 1], opacity: [0.3, 0.85] }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          />
          {/* Neckline curve */}
          <motion.path
            d="M78 48 Q100 60 122 48"
            stroke="var(--draep-orange)"
            strokeWidth="2"
            strokeLinecap="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: [0, 1] }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut", delay: 0.6 }}
          />
          {/* Center seam */}
          <motion.path
            d="M100 60 L100 122"
            stroke="var(--draep-orange)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeDasharray="3 3"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: [0, 1] }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut", delay: 1.1 }}
          />

          {/* The pen / artist's hand — sways as if drawing */}
          <motion.g
            animate={{ x: [0, 4, -3, 0], y: [0, -2, 1, 0], rotate: [0, 3, -2, 0] }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
            style={{ transformOrigin: "150px 40px" }}
          >
            {/* pen body */}
            <line x1="150" y1="40" x2="172" y2="20" stroke="var(--ink-navy)" strokeWidth="3" strokeLinecap="round" />
            {/* pen nib */}
            <line x1="148" y1="42" x2="152" y2="38" stroke="var(--draep-orange)" strokeWidth="3" strokeLinecap="round" />
            {/* hand */}
            <ellipse cx="158" cy="30" rx="9" ry="6" fill="var(--ink-navy)" opacity="0.12" />
          </motion.g>
        </svg>
      </div>

      <div className="flex w-full max-w-[240px] flex-col items-center gap-2">
        <motion.p
          className="font-heading text-h3 font-semibold text-ink-navy"
          animate={{ opacity: [0.65, 1, 0.65] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
        >
          {strings.myod.generating}
        </motion.p>

        {/* Timed progress bar — CSS-driven width 0→100% over exactly 60s. */}
        <div className="h-1.5 w-full overflow-hidden rounded-pill bg-tape-silver">
          <div
            className="h-full rounded-full"
            style={{
              backgroundImage: "var(--tape-gradient)",
              animation: "myod-progress-fill 60s linear forwards",
            }}
          />
        </div>
      </div>
    </motion.div>
  );
}

function LoadingTree() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex h-[44vh] flex-col items-center justify-center gap-3 text-muted"
    >
      <motion.div
        className="h-10 w-10 rounded-full border-2 border-navy-interactive/30 border-t-navy-interactive"
        animate={{ rotate: 360 }}
        transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
      />
      <p className="text-caption">{strings.myod.loadingTree}</p>
    </motion.div>
  );
}

function ErrorStage({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.25 }}
      className="flex flex-col items-center gap-3 px-6 py-10 text-center"
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-error-bg text-error-text">
        <Close size={22} />
      </div>
      <p className="font-heading text-h3 font-semibold text-ink-navy">{strings.myod.errorTitle}</p>
      <p className="text-body text-muted">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-1 rounded-pill bg-tape px-5 py-2.5 text-body font-semibold text-chalk-white shadow-primary transition-all hover:brightness-105 active:scale-[0.98]"
        style={{ backgroundImage: "var(--tape-gradient)" }}
      >
        {strings.myod.errorRetry}
      </button>
    </motion.div>
  );
}

/* ─── Glyphs ──────────────────────────────────────────────────────────── */

function MicGlyph({ active }: { active: boolean }) {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {active ? (
        <>
          <rect x="9" y="2" width="6" height="12" rx="3" fill="currentColor" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v4" />
        </>
      ) : (
        <>
          <rect x="9" y="2" width="6" height="12" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v4" />
        </>
      )}
    </svg>
  );
}

function SendGlyph() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" />
    </svg>
  );
}

// Re-export for any external consumers.
export { labelText };
