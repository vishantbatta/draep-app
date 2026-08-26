"use client";

/**
 * MyodSheet — "Make Your Own Draep", vector SVG configurator.
 *
 * Shows two SVG line drawings (front + back) of the garment. On load, uses the
 * garment's asset_urls as the base SVGs. When the user selects a non-default
 * option, sends the current SVGs + full config + edit history to
 * /myod/svg-edit and gets back updated front + back SVGs.
 *
 * No render-mode toggle — just the one A1 (SVG edit) approach.
 */

import { AnimatePresence, motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { LoginGateSheet } from "@/components/auth/LoginGateSheet";
import { BottomSheet } from "@/components/ui/BottomSheet";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Close,
  Plus,
  Sparkles,
} from "@/components/ui/icons";
import { getGarmentTree, listGarments } from "@/lib/api/catalog";
import { ApiError } from "@/lib/api/client";
import { useAuthHydrated, useAuthStore } from "@/lib/auth-store";
import {
  createMyodOrder,
  editBlouseSvg,
  renderBlouseViews,
  type MyodRenderView,
} from "@/lib/api/myod";
import {
  buildDesignSteps,
  computeSelectionPrice,
  describeSelection,
  labelText,
  placementLabel,
  selectionAmount,
  type ComponentSelection,
  type DesignStep,
  type MyodPriceLine,
  type PlacementPick,
  type Selections,
  type StepAxis,
  type StepComponent,
  type StepOption,
} from "@/lib/myod-steps";
import { formatPrice } from "@/lib/pricing";
import { strings } from "@/lib/strings";
import { track } from "@/lib/analytics";
import type { GarmentTreeOut } from "@/types/api";

type Phase = "loading-tree" | "ready" | "generating" | "error";

export function MyodSheet({
  garmentId,
  footerInset,
  onBackChange,
}: {
  garmentId?: string;
  /**
   * CSS `bottom` value for the fixed step-CTA bar when a host owns the bottom
   * of the screen (e.g. the /app tab bar). Also lifts the root's scroll-room
   * padding. The host's bar is responsible for the safe-area inset, so this
   * bar drops its own in that case.
   */
  footerInset?: string;
  /**
   * Hosts that render their own Back affordance (the /app create tab puts it
   * in the page header) get the current step-back action reported here — a
   * callable while a previous step exists, null otherwise. While set,
   * MyodSheet hides its own in-flow Back pill.
   */
  onBackChange?: (back: (() => void) | null) => void;
}) {
  const router = useRouter();
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
  // Root of this flow — used to find the scroll container that hosts it
  // (the window on /app/create, a nested overflow body on /myod/{id}).
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Set once the user taps the final "Generate" CTA on the extras step and
  // the image matches their full config — swaps the step list for the
  // completion view.
  const [finished, setFinished] = useState(false);

  // AI product renders of the finished blouse (front/back/side), kicked off
  // by the Generate CTA. renderCtx keeps the exact inputs so the user can
  // retry a failed render without re-running the whole generate flow — and
  // so a second Generate with an unchanged design reuses the existing
  // renders instead of re-calling the model. Regeneration adds a customer
  // comment + the previous renders as image references.
  type RenderCtx = {
    frontSvg: string;
    backSvg: string;
    configText: string;
    comment?: string;
    referenceImages?: string[];
  };
  const [renderViews, setRenderViews] = useState<MyodRenderView[]>([]);
  const [renderPhase, setRenderPhase] = useState<
    "idle" | "rendering" | "done" | "error"
  >("idle");
  const [renderCtx, setRenderCtx] = useState<RenderCtx | null>(null);
  // Server-supplied failure reason (quota 503 → "tap Retry in a minute");
  // null → the generic renderFailed line.
  const [renderError, setRenderError] = useState<string | null>(null);
  const [showRegenSheet, setShowRegenSheet] = useState(false);
  // Price-breakdown sheet opened from the running-total bar.
  const [priceSheetOpen, setPriceSheetOpen] = useState(false);
  // Complete Order CTA: creation in flight / failure reason.
  const [ordering, setOrdering] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);

  // ── Login gate on Generate Blouse ──────────────────────────────────
  // Anonymous visitors verify their phone before the AI render fires.
  const sessionType = useAuthStore((s) => s.sessionType);
  const authHydrated = useAuthHydrated();
  const isLoggedIn = sessionType === "user";
  const [showLoginGate, setShowLoginGate] = useState(false);
  // Generate was tapped while logged out — re-run it after the gate verifies.
  const [generateAfterLogin, setGenerateAfterLogin] = useState(false);

  // ── Load the garment tree on mount ──────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setPhase("loading-tree");
      setErrorMsg(null);
      try {
        // The route segment (/myod/<garment_id>) carries the garment's id or
        // slug — try it as an id first, then resolve it as a slug.
        let t: GarmentTreeOut;
        if (garmentId) {
          try {
            t = await getGarmentTree(garmentId);
          } catch (err) {
            const notFound = err instanceof ApiError && err.status === 404;
            if (!notFound) throw err;
            const list = await listGarments();
            const bySlug = (list.items ?? []).find((g) => g.slug === garmentId);
            if (!bySlug) throw err;
            t = await getGarmentTree(bySlug.id);
          }
        } else {
          const list = await listGarments();
          const blouse =
            (list.items ?? []).find((g) => g.slug === "blouse") ??
            (list.items ?? [])[0];
          if (!blouse) throw new Error("No blouse garment found.");
          t = await getGarmentTree(blouse.id);
        }
        if (cancelled) return;
        setTree(t);
        // Prefill the extras rows with what the CATALOG marks as default —
        // never an invented first option. See extrasDefaults().
        setSelections(extrasDefaults(buildDesignSteps(t)));
        // Starts empty: the skip-check compares EFFECTIVE selections (explicit
        // ∪ defaults) on both sides, so the defaults don't need seeding here.
        setImageSelections({});
        setActiveStepIdx(0);
        // Load base SVGs from asset_urls (fetch the SVG file content)
        const assets = t.asset_urls ?? [];
        const fetchSvg = async (
          url: string | undefined,
        ): Promise<string | null> => {
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
        const back = (await fetchSvg(assets[1])) ?? front;
        if (cancelled) return;
        setFrontSvg(front);
        setBackSvg(back);
        setPhase("ready");
        track({ event: "myod_opened", source: "library" });
      } catch (err) {
        if (cancelled) return;
        setErrorMsg(
          err instanceof Error
            ? err.message
            : "Couldn't load the design options.",
        );
        setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [garmentId]);

  const activeStep: DesignStep | undefined = steps[activeStepIdx];

  // ── Hosted Back button ─────────────────────────────────────────────
  // Report the step-back action to the host header while a previous step
  // exists (and suppress our own in-flow pill). The effect only fires on
  // availability flips — the reported closure reads no render state.
  const hostedBackAvailable =
    !!onBackChange &&
    !finished &&
    activeStepIdx > 0 &&
    phase !== "loading-tree" &&
    !(phase === "error" && !frontSvg);
  useEffect(() => {
    if (!onBackChange) return;
    onBackChange(
      hostedBackAvailable
        ? () => setActiveStepIdx((i) => Math.max(0, i - 1))
        : null,
    );
  }, [hostedBackAvailable, onBackChange]);
  // Clear the hosted button if the configurator unmounts (tab closes).
  useEffect(() => () => onBackChange?.(null), [onBackChange]);

  // Default selection per component — used to resolve the EFFECTIVE config
  // (explicit ∪ defaults) when deciding whether an edit changes the design.
  const defaultsMap = useMemo(() => defaultSelections(steps), [steps]);
  const allComponents = useMemo(
    () => steps.flatMap((s) => s.components),
    [steps],
  );
  // Running total — base price + one additive amount per selection, exactly
  // the rules the created order's breakdown will apply (see myod-steps).
  const priceBreakdown = useMemo(
    () => computeSelectionPrice(steps, selections, tree?.base_price ?? null),
    [steps, selections, tree],
  );
  // Add-ons that are part of the base design (default-on). When one is cleared
  // from the live design it needs an "__off__" tombstone in the image state,
  // so re-enabling it later is detected as a real change.
  const baseAddonIds = useMemo(
    () =>
      allComponents
        .filter((c) => c.section === "Add-ons" && defaultsMap[c.id])
        .map((c) => c.id),
    [allComponents, defaultsMap],
  );

  // ── Config summary builder ──────────────────────────────────────────
  const buildConfigSummary = useCallback(
    (sels: Selections): string => {
      if (!tree) return "";
      const lines: string[] = [];
      for (const c of sortedComponents(tree)) {
        const sel = sels[c.id];
        // Add-ons are opt-in: they appear only once the user enables them —
        // never fall back to a default/first variation that wasn't chosen.
        // Components resolve to explicit ∪ catalog default; a component with
        // no default at all is omitted rather than invented.
        const isAddon = c.section === "Add-ons";
        // Multi-spot add-on: one line per spot (labels already name the spot).
        if (isAddon && sel?.picks && sel.picks.length > 0) {
          for (const pick of sel.picks) {
            const opt = c.options.find((o) => o.id === pick.variationId);
            if (!opt) continue;
            let line = `- ${c.label}: ${opt.label}`;
            if (c.description) line += ` — ${c.description}`;
            if (opt.description) line += ` | ${opt.description}`;
            lines.push(line);
          }
          continue;
        }
        const chosenId = isAddon
          ? sel?.variationId
          : (sel?.variationId ?? c.defaultOptionId);
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

  // ── Config for the final AI render ─────────────────────────────────
  // Unlike buildConfigSummary (which predates opt-in add-ons and falls back
  // to an add-on's first variation when unset), this builder is accurate for
  // renders: critical components resolve to explicit ∪ default, opt-in
  // add-ons appear ONLY when the user actually enabled them.
  const buildRenderConfig = useCallback(
    (sels: Selections): string => {
      const lines: string[] = [];
      for (const step of steps) {
        for (const c of step.components) {
          const sel = sels[c.id];
          if (c.kind === "toggle" || c.options.length === 0) {
            if (sel && sel.variationId !== "__off__") {
              const opt = c.options.find((o) => o.id === sel.variationId);
              let line = `- ${c.label}: ${opt?.label ?? "on"}`;
              if (sel.variationTypeId && opt?.subOptions) {
                const sub = opt.subOptions.find(
                  (s) => s.id === sel.variationTypeId,
                );
                if (sub) line += ` — ${sub.label}`;
              }
              if (sel.placement)
                line += ` (placed on ${placementLabel(sel.placement)})`;
              if (c.description) line += ` — ${c.description}`;
              lines.push(line);
            }
            continue;
          }
          // Multi-spot add-on: one line per spot.
          if (c.section === "Add-ons" && sel?.picks && sel.picks.length > 0) {
            for (const pick of sel.picks) {
              const opt = c.options.find((o) => o.id === pick.variationId);
              if (!opt) continue;
              lines.push(`- ${c.label}: ${opt.label}`);
            }
            continue;
          }
          const chosenId =
            c.section === "Add-ons"
              ? sel?.variationId
              : (sel?.variationId ?? c.defaultOptionId);
          const opt = c.options.find((o) => o.id === chosenId);
          if (!opt) continue;
          let line = `- ${c.label}: ${opt.label}`;
          const subId =
            sel?.variationTypeId ??
            opt.defaultSubOptionId ??
            opt.subOptions?.[0]?.id;
          const sub = opt.subOptions?.find((s) => s.id === subId);
          if (sub) line += ` — ${sub.label}`;
          if (opt.description) line += ` — ${opt.description}`;
          lines.push(line);
        }
      }
      return lines.join("\n");
    },
    [steps],
  );

  // ── Apply an edit ───────────────────────────────────────────────────
  // Returns the FINAL { frontSvg, backSvg } on success (null on failure or
  // when superseded) so callers like the Generate flow can immediately chain
  // a render off the just-generated drawings without stale-closure reads.
  const applyChange = useCallback(
    async (
      changeLabel: string,
      changeDescription: string,
      allSelections: Selections,
    ): Promise<{ frontSvg: string; backSvg: string } | null> => {
      if (!frontSvg || !backSvg) return null;
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
        if (token !== genTokenRef.current) return null;
        setFrontSvg(result.front_svg);
        setBackSvg(result.back_svg);
        // Record the new image state, keeping explicit "off" tombstones for
        // components that were on and are now cleared — otherwise re-enabling
        // them later would compare equal to the default and skip the redraw.
        // Base-design (default-on) add-ons count as "on" in the image being
        // replaced even before any redraw recorded them.
        const nextImage: Selections = { ...allSelections };
        for (const id of new Set([
          ...Object.keys(imageSelections),
          ...baseAddonIds,
        ])) {
          if (!(id in nextImage)) nextImage[id] = { variationId: "__off__" };
        }
        setImageSelections(nextImage);
        historyRef.current.push(changeLabel);
        setPhase("ready");
        track({ event: "myod_succeeded" });
        return { frontSvg: result.front_svg, backSvg: result.back_svg };
      } catch (err) {
        if (token !== genTokenRef.current) return null;
        setErrorMsg(
          err instanceof Error ? err.message : "Something went wrong.",
        );
        setPhase("ready");
        track({
          event: "myod_failed",
          error: err instanceof Error ? err.message : undefined,
        });
        return null;
      }
    },
    [frontSvg, backSvg, imageSelections, buildConfigSummary, baseAddonIds],
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
      // Advance only if the user is still on the step this tap was made on.
      // Rapid re-taps on the same step (possible now that selections stay
      // enabled during generation) then advance exactly once instead of once
      // per tap, and a background generation never yanks the user forward
      // after they've navigated back.
      const tappedIdx = activeStepIdx;
      const advance = () => {
        if (!shouldAdvance) return;
        setActiveStepIdx((i) =>
          i === tappedIdx ? Math.min(steps.length - 1, i + 1) : i,
        );
      };

      // Skip the Gemini round-trip when the requested config resolves to the
      // same effective design as the current image. See requestedForCompare /
      // depictedForCompare for how each side resolves defaults and off states.
      const sameSelection = (x?: ComponentSelection, y?: ComponentSelection) =>
        (x?.variationId ?? null) === (y?.variationId ?? null) &&
        (x?.variationTypeId ?? null) === (y?.variationTypeId ?? null) &&
        myodPicksEqual(x?.picks, y?.picks);
      const sameDesign = allComponents.every((c) =>
        sameSelection(
          requestedForCompare(c, next[c.id], defaultsMap),
          depictedForCompare(c, imageSelections[c.id], defaultsMap),
        ),
      );
      if (sameDesign) {
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
    [
      selections,
      imageSelections,
      steps,
      activeStepIdx,
      defaultsMap,
      allComponents,
      applyChange,
    ],
  );

  const retry = useCallback(() => {
    setErrorMsg(null);
    setPhase("ready");
  }, []);

  // ── Final AI render (front / back / side product photos) ────────────
  // opts.skipViews = targeted gap-fill: only the MISSING views are
  // re-rendered (the backend skips the named ones), the good photos stay
  // on screen while the gaps spin, and the response is merged in by view
  // instead of replacing the set.
  const startRender = useCallback(
    (ctx: RenderCtx, opts?: { skipViews?: string[] }) => {
      const targeted = !!opts?.skipViews?.length;
      setRenderCtx(ctx);
      if (!targeted) setRenderViews([]);
      setRenderError(null);
      setRenderPhase("rendering");
      renderBlouseViews({
        frontSvg: ctx.frontSvg,
        backSvg: ctx.backSvg,
        configText: ctx.configText,
        comment: ctx.comment,
        referenceImages: ctx.referenceImages,
        skipViews: opts?.skipViews,
      })
        .then((res) => {
          if (targeted) {
            setRenderViews((prev) => mergeRenderViews(prev, res.views));
            // Even with nothing new, keep the grid: the missing tiles show
            // their own retry.
            setRenderPhase("done");
          } else {
            setRenderViews(res.views);
            setRenderPhase(res.views.length ? "done" : "error");
          }
          if (res.views.length)
            track({ event: "myod_render_succeeded", views: res.views.length });
          else track({ event: "myod_render_failed" });
        })
        .catch((err: unknown) => {
          // A failed gap-fill keeps the good views on screen; a failed full
          // render drops to the error card. Surface the server's reason when
          // it sent one (quota 503 tells the user when to tap Retry).
          if (!targeted)
            setRenderError(
              err instanceof ApiError && err.message ? err.message : null,
            );
          setRenderPhase(targeted ? "done" : "error");
          track({ event: "myod_render_failed" });
        });
    },
    [],
  );

  // ── Complete Order CTA — turn this run into a pending order ────────
  // Sends the wizard selections + rendered photos; the backend stores the
  // renders as the garment order's inspiration images (same field the admin
  // order page reads). Then hands off to the /app order page, where the
  // customer books the visit (address → slot → payment).
  const handleCompleteOrder = useCallback(async () => {
    if (ordering || !tree || !renderCtx || !renderViews.length) return;
    setOrdering(true);
    setOrderError(null);
    track({ event: "myod_order_cta", cta: "complete_order" });
    try {
      const order = await createMyodOrder({
        garmentId: tree.id,
        selections,
        assets: renderViews.map((v) => v.url),
      });
      track({ event: "myod_order_created", order_id: order.id });
      router.push(`/app/orders/${order.id}`);
    } catch (err) {
      setOrderError(
        err instanceof ApiError && err.message
          ? err.message
          : "We couldn't create your order. Please try again.",
      );
      setOrdering(false);
    }
  }, [ordering, tree, renderCtx, renderViews, selections, router]);

  // ── Final "Generate Blouse" CTA (extras step) ────────────────────────
  const onExtrasStep = !!steps[activeStepIdx]?.isExtras;
  const showFinalCta = onExtrasStep && !finished;

  const handleGenerate = useCallback(() => {
    // Login gate: anonymous visitors verify their phone before generating.
    // (Not-hydrated-yet passes through — by CTA time the persisted session
    // has long rehydrated; a stale null here would gate a logged-in user.)
    if (authHydrated && !isLoggedIn) {
      setShowLoginGate(true);
      return;
    }
    if (phase === "generating") return;
    // After the drawings are final, swap in the completion view and kick off
    // the 3-view AI render off the FINAL svgs (passed explicitly — the state
    // closure would still hold the pre-edit pair).
    const finish = (
      finalSvgs?: { frontSvg: string; backSvg: string } | null,
    ) => {
      setFinished(true);
      track({ event: "myod_generated" });
      const front = finalSvgs?.frontSvg ?? frontSvg;
      const back = finalSvgs?.backSvg ?? backSvg;
      if (front && back) {
        const configText = buildRenderConfig(selections);
        // Reuse the existing renders when nothing behind them changed: same
        // drawings + same effective config (covers the keep-editing →
        // Generate-again loop). "rendering" also reuses — a matching render
        // is already in flight; "error" re-renders (there is nothing to show).
        const reusable =
          renderCtx &&
          (renderPhase === "done" || renderPhase === "rendering") &&
          renderCtx.frontSvg === front &&
          renderCtx.backSvg === back &&
          renderCtx.configText === configText;
        if (reusable) {
          track({ event: "myod_render_reused" });
          return;
        }
        startRender({ frontSvg: front, backSvg: back, configText });
      }
    };
    // Same effective-config check as option taps: if the drawings already
    // depict the full config there is nothing left to generate. See
    // requestedForCompare / depictedForCompare for the fallback semantics.
    const sameSel = (x?: ComponentSelection, y?: ComponentSelection) =>
      (x?.variationId ?? null) === (y?.variationId ?? null) &&
      (x?.variationTypeId ?? null) === (y?.variationTypeId ?? null) &&
      myodPicksEqual(x?.picks, y?.picks);
    const sameDesign = allComponents.every((c) =>
      sameSel(
        requestedForCompare(c, selections[c.id], defaultsMap),
        depictedForCompare(c, imageSelections[c.id], defaultsMap),
      ),
    );
    if (sameDesign) {
      finish();
      return;
    }
    // One final pass that folds every pending non-default choice into a
    // single instruction, so the output reflects the complete design.
    const lines: string[] = [];
    for (const step of steps) {
      for (const c of step.components) {
        const sel = selections[c.id];
        if (!sel) continue;
        if (sel.variationId === "__off__") {
          lines.push(`${c.label}: off`);
          continue;
        }
        // Multi-spot add-on: one line per spot.
        if (sel.picks && sel.picks.length > 0) {
          for (const pick of sel.picks) {
            const opt = c.options.find((o) => o.id === pick.variationId);
            lines.push(`${c.label}: ${opt?.label ?? "on"}`);
          }
          continue;
        }
        const opt = c.options.find((o) => o.id === sel.variationId);
        let line = `${c.label}: ${opt?.label ?? "on"}`;
        if (sel.variationTypeId && opt?.subOptions) {
          const sub = opt.subOptions.find((s) => s.id === sel.variationTypeId);
          if (sub) line += ` — ${sub.label}`;
        }
        if (sel.placement)
          line += ` — placed at ${placementLabel(sel.placement)}`;
        lines.push(line);
      }
    }
    const desc = lines.length
      ? "Apply every pending selection in one final pass:\n" +
        lines.map((l) => "  • " + l).join("\n")
      : "Final blouse with all defaults.";
    track({ event: "myod_generate" });
    void applyChange("Final blouse", desc, selections).then(finish);
  }, [
    phase,
    steps,
    selections,
    imageSelections,
    defaultsMap,
    allComponents,
    applyChange,
    frontSvg,
    backSvg,
    buildRenderConfig,
    startRender,
    renderCtx,
    renderPhase,
    authHydrated,
    isLoggedIn,
  ]);

  // The gate's verify flips sessionType in the store; this effect re-runs the
  // blocked generate on the next render, with a logged-in closure (fresh
  // selections etc.) instead of the stale one from before the sheet opened.
  useEffect(() => {
    if (!generateAfterLogin || !isLoggedIn) return;
    setGenerateAfterLogin(false);
    handleGenerate();
  }, [generateAfterLogin, isLoggedIn, handleGenerate]);

  // Fresh step, fresh scroll: option lists are long and the old step's
  // scroll position would otherwise land the new step mid-list. Reset
  // whichever ancestor actually scrolls. Skipped while this pane is hidden
  // (display:none) so a background generation advancing the step can't
  // hijack the visible page's scroll.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || el.offsetParent == null) return;
    let node: HTMLElement | null = el.parentElement;
    while (node) {
      const { overflowY } = getComputedStyle(node);
      if (
        /(auto|scroll|overlay)/.test(overflowY) &&
        node.scrollHeight > node.clientHeight
      ) {
        node.scrollTo({ top: 0 });
        return;
      }
      node = node.parentElement;
    }
    window.scrollTo({ top: 0 });
  }, [activeStepIdx]);

  // Regenerate from the completion view: same drawings + config, plus the
  // customer's comment and the previous renders as image references.
  const startRegenerate = useCallback(
    (comment: string) => {
      if (!renderCtx || renderPhase === "rendering") return;
      setShowRegenSheet(false);
      track({ event: "myod_render_regenerate", has_comment: !!comment });
      startRender({
        ...renderCtx,
        comment: comment || undefined,
        referenceImages: renderViews.map((v) => v.url),
      });
    },
    [renderCtx, renderPhase, renderViews, startRender],
  );

  const hasNonDefault = Object.keys(selections).length > 0;

  // Slim running-total ticker on the choice steps (the extras step carries
  // its total inside the Generate CTA bar instead).
  const showPriceBar =
    !finished &&
    !!activeStep &&
    !showFinalCta &&
    phase !== "loading-tree" &&
    !(phase === "error" && !frontSvg);

  return (
    // pb grows on the extras step so the sticky final CTA never overlaps the
    // last content row (bar ≈ 76px + safe-area inset, plus footerInset when
    // a host bar owns the bottom of the screen). The choice steps reserve a
    // slimmer amount for the price ticker.
    <div
      ref={rootRef}
      className={
        "relative mx-auto flex w-full max-w-column flex-col gap-4 px-4 " +
        (showFinalCta ? "pb-32" : showPriceBar ? "pb-24" : "pb-6")
      }
      style={
        footerInset && (showFinalCta || showPriceBar)
          ? {
              paddingBottom: `calc(${showFinalCta ? 128 : 96}px + (${footerInset}))`,
            }
          : undefined
      }
    >
      {/* Phase swap is a plain conditional (no AnimatePresence/motion):
          exit/enter animations run on requestAnimationFrame, which browsers
          suspend in backgrounded webviews — gating the main UI on them froze
          this flow at the loading screen until the tab was foregrounded. */}
      {phase === "loading-tree" && <LoadingTree key="lt" />}
      {phase === "error" && !frontSvg && (
        <ErrorStage
          key="err"
          message={errorMsg ?? "Something went wrong."}
          onRetry={retry}
        />
      )}
      {phase !== "loading-tree" && !(phase === "error" && !frontSvg) && (
        <div className="flex flex-col gap-4">
          {/* SVG previews */}
          <SvgStage
            frontSvg={frontSvg}
            backSvg={backSvg}
            generating={phase === "generating"}
          />

          {/* Step options — after Generate the completion view takes over the
              full page (rendered at the root below). */}
          {!finished && activeStep && (
            <StepCards
              step={activeStep}
              stepIndex={activeStepIdx}
              totalSteps={steps.length}
              selections={selections}
              // Stays enabled while generating: re-selecting mid-flight is
              // safe — genTokenRef drops the stale response and the newest
              // request already carries the full config.
              disabled={false}
              generating={phase === "generating"}
              onBack={
                // Hosted (header) Back owns this while onBackChange is set.
                onBackChange
                  ? undefined
                  : activeStepIdx > 0
                    ? () => setActiveStepIdx((i) => Math.max(0, i - 1))
                    : undefined
              }
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
        </div>
      )}

      {/* ── Sticky final CTA (extras step) ────────────────────────────────
          Sits above the viewport bottom; the root's pb-32 reserves scroll
          room so it never covers the last extras row. z-40 keeps it under
          the open picker sheets (BottomSheet backdrop is z-50). */}
      {showFinalCta && (
        <div
          className={
            "fixed inset-x-0 bottom-0 z-40 border-t border-hairline bg-chalk-white/95 backdrop-blur-sm " +
            (footerInset ? "pb-0" : "pb-[env(safe-area-inset-bottom)]")
          }
          style={footerInset ? { bottom: footerInset } : undefined}
        >
          <div className="mx-auto flex w-full max-w-column items-center justify-between gap-3 px-4 py-3">
            <button
              type="button"
              onClick={() => setPriceSheetOpen(true)}
              className="flex min-w-0 shrink-0 flex-col gap-0.5 text-left"
            >
              <span className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-muted">
                {strings.myod.estTotal}
              </span>
              <span className="flex items-center gap-1 font-heading text-h3 font-semibold leading-none text-ink-navy">
                {formatPrice(priceBreakdown.total)}
                <ChevronDown size={14} className="rotate-180 text-muted" />
              </span>
            </button>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={phase === "generating"}
              className="flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-pill text-body font-semibold text-chalk-white shadow-brand transition-all ease-brand active:scale-[0.98] disabled:opacity-60"
              style={{ backgroundImage: "var(--tape-gradient)" }}
            >
              {phase === "generating" ? (
                <>
                  <BrandSpinner size={18} />
                  {strings.myod.generating}
                </>
              ) : (
                <>
                  {strings.myod.finalCta}
                  <ArrowRight size={18} />
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ── Slim running-total ticker (choice steps) ─────────────────────
          Same fixed slot the final CTA occupies, so the total stays visible
          as each step adds to it. Tapping it expands the breakdown sheet.
          z-40 keeps it under the picker sheets. */}
      {showPriceBar && (
        <div
          className={
            "fixed inset-x-0 bottom-0 z-40 border-t border-hairline bg-chalk-white/95 backdrop-blur-sm " +
            (footerInset ? "pb-0" : "pb-[env(safe-area-inset-bottom)]")
          }
          style={footerInset ? { bottom: footerInset } : undefined}
        >
          <button
            type="button"
            onClick={() => setPriceSheetOpen(true)}
            className="mx-auto flex w-full max-w-column items-center justify-between gap-3 px-4 py-2.5 text-left"
          >
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-muted">
                {strings.myod.estTotal}
              </span>
              <span className="text-[11px] leading-tight text-muted">
                {strings.myod.priceTaxNote}
              </span>
            </span>
            <span className="flex items-center gap-1 font-heading text-h3 font-semibold leading-none text-ink-navy">
              {formatPrice(priceBreakdown.total)}
              <ChevronDown size={14} className="rotate-180 text-muted" />
            </span>
          </button>
        </div>
      )}

      {/* ── Full-page completion view (after Generate Blouse) ────────────
          Takes over the entire viewport — configurator header included.
          z-40 keeps it under the picker sheets (z-50), none of which can be
          open here. The configurator stays mounted underneath so "Keep
          editing" restores it with all state and scroll intact. */}
      {finished && (
        <>
          <CompletionPage
            views={renderViews}
            phase={renderPhase}
            errorMessage={renderPhase === "error" ? renderError : null}
            total={priceBreakdown.total}
            orderBusy={ordering}
            orderError={orderError}
            onCompleteOrder={handleCompleteOrder}
            onRetry={() => renderCtx && startRender(renderCtx)}
            onRetryMissing={() => {
              if (!renderCtx || renderPhase === "rendering") return;
              const have = renderViews.filter((v) => v.url).map((v) => v.view);
              if (!have.length || have.length === RENDER_VIEW_ORDER.length)
                return;
              startRender(renderCtx, { skipViews: have });
            }}
            onKeepEditing={() => setFinished(false)}
            onRegenerate={() => setShowRegenSheet(true)}
          />
          {/* Regenerate sheet — above the completion takeover (z-40), same
              layer as the other picker sheets (z-50). */}
          <RegenerateSheet
            open={showRegenSheet}
            busy={renderPhase === "rendering"}
            previews={renderViews}
            onClose={() => setShowRegenSheet(false)}
            onConfirm={startRegenerate}
          />
        </>
      )}

      {/* Price breakdown — expands from the running-total bar. Same layer
          as the other picker sheets (z-50), above the fixed bars (z-40). */}
      <PriceBreakdownSheet
        open={priceSheetOpen}
        onClose={() => setPriceSheetOpen(false)}
        base={priceBreakdown.base}
        lines={priceBreakdown.lines}
        total={priceBreakdown.total}
      />

      {/* Login gate — opens when Generate Blouse is tapped logged-out; the
          verify success closes it and the effect above re-runs generate. */}
      <LoginGateSheet
        open={showLoginGate}
        onClose={() => setShowLoginGate(false)}
        onSuccess={() => {
          setShowLoginGate(false);
          setGenerateAfterLogin(true);
        }}
      />
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────

/**
 * Price tag for an option card: "+ ₹200" when the choice adds to the base
 * price. Free / unpriced options render no tag at all.
 */
function OptionPrice({ price }: { price: number | undefined }) {
  if (!(price ?? 0)) return null;
  return (
    <span className="shrink-0 font-mono text-[11px] font-semibold leading-tight tracking-wide text-accent-text">
      {`+ ${formatPrice(price!)}`}
    </span>
  );
}

/**
 * Bottom sheet opened from the running-total bar — the full additive
 * breakdown behind the estimate: base + one line per priced selection.
 */
function PriceBreakdownSheet({
  open,
  onClose,
  base,
  lines,
  total,
}: {
  open: boolean;
  onClose: () => void;
  base: number;
  lines: MyodPriceLine[];
  total: number;
}) {
  return (
    <BottomSheet open={open} onClose={onClose} title={strings.myod.priceSheetTitle}>
      <div className="flex flex-col gap-3 pb-8 pt-2">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-body text-ink-navy">{strings.myod.priceBaseLine}</span>
          <span className="font-mono text-body font-semibold text-ink-navy">
            {formatPrice(base)}
          </span>
        </div>
        {lines.map((line, i) => (
          <div key={`${line.label}-${i}`} className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 text-body text-ink-navy">{line.label}</span>
            <span className="shrink-0 font-mono text-body font-semibold text-accent-text">
              {`+ ${formatPrice(line.amount)}`}
            </span>
          </div>
        ))}
        <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-hairline pt-3">
          <span className="font-heading text-h3 text-ink-navy">{strings.myod.estTotal}</span>
          <span className="font-heading text-h3 font-semibold text-ink-navy">
            {formatPrice(total)}
          </span>
        </div>
        <p className="text-caption leading-snug text-muted">{strings.myod.priceSheetNote}</p>
      </div>
    </BottomSheet>
  );
}

function defaultSelections(steps: DesignStep[]): Selections {
  const out: Selections = {};
  for (const step of steps) {
    for (const comp of step.components) {
      if (comp.kind === "toggle") {
        if (comp.defaultOn) out[comp.id] = { variationId: "__toggle_on__" };
        continue;
      }
      // Add-ons are opt-in: only default-on ones belong to the base design.
      // A default-on add-on resolves to its default variation, else its first
      // variation — mirroring extrasDefaults so seeded rows count as
      // "default" in the same-design checks (no spurious redraws).
      if (comp.section === "Add-ons" && !comp.defaultOn) continue;
      const def =
        comp.defaultOptionId ??
        (comp.defaultOn ? comp.options[0]?.id : undefined);
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

/** Sentinel meaning "explicitly off" — never equal to a real variation id. */
const OFF_SELECTION: ComponentSelection = { variationId: "__off__" };

/** Deep compare of two selections' multi-spot picks (order-sensitive). */
function myodPicksEqual(
  a: PlacementPick[] | undefined,
  b: PlacementPick[] | undefined,
): boolean {
  const pa = a ?? [];
  const pb = b ?? [];
  if (pa.length !== pb.length) return false;
  return pa.every(
    (p, i) =>
      p.variationId === pb[i].variationId &&
      (p.variationTypeId ?? null) === (pb[i].variationTypeId ?? null) &&
      p.placement === pb[i].placement,
  );
}

/**
 * Effective-selection resolution for the skip-if-same-design checks. The two
 * sides answer different questions, so they fall back differently:
 *  - REQUESTED (what the user wants): non-add-ons fall back to catalog
 *    defaults; add-ons are opt-in, so unset means OFF.
 *  - DEPICTED (what the current image shows): the recorded image selection
 *    first (incl. "__off__" tombstones), else the base design — the catalog
 *    defaults, which include default-on add-ons — else OFF for add-ons.
 * Net effect: the seeded default walk is a no-op, while clearing a default-on
 * add-on or enabling an opt-in one always counts as a real change.
 */
function requestedForCompare(
  comp: StepComponent,
  sel: ComponentSelection | undefined,
  defaultsMap: Selections,
): ComponentSelection | undefined {
  if (comp.section !== "Add-ons") return sel ?? defaultsMap[comp.id];
  return sel ?? OFF_SELECTION;
}

function depictedForCompare(
  comp: StepComponent,
  imageSel: ComponentSelection | undefined,
  defaultsMap: Selections,
): ComponentSelection | undefined {
  if (comp.section !== "Add-ons") return imageSel ?? defaultsMap[comp.id];
  return imageSel ?? defaultsMap[comp.id] ?? OFF_SELECTION;
}

/**
 * Seed the extras ("Fit, details & add-ons") rows with CATALOG defaults only —
 * nothing arbitrary:
 *  - Fit components (blouse length, shoulder, …) always resolve to their
 *    default_variation_id, exactly like the critical steps do implicitly.
 *  - An add-on is included ONLY when the catalog sets is_default_on — anything
 *    else stays opt-in. A default-on toggle starts ON; a default-on choice
 *    selects its default variation, falling back to the first variation when
 *    admin hasn't named one (being ON requires a concrete pick).
 * The sub-type resolution mirrors defaultSelections so seeded rows compare
 * equal to the effective defaults in the skip-if-matches check (no spurious
 * redraws on entering extras).
 */
function extrasDefaults(steps: DesignStep[]): Selections {
  const out: Selections = {};
  for (const step of steps) {
    if (!step.isExtras) continue;
    for (const c of step.components) {
      if (c.section === "Add-ons") {
        if (!c.defaultOn) continue;
        if (c.kind === "toggle" || c.options.length === 0) {
          out[c.id] = { variationId: "__toggle_on__" };
          continue;
        }
        const def = c.defaultOptionId ?? c.options[0]?.id;
        if (!def) continue;
        const opt = c.options.find((o) => o.id === def);
        out[c.id] = {
          variationId: def,
          variationTypeId: opt?.defaultSubOptionId ?? opt?.subOptions?.[0]?.id,
        };
        continue;
      }
      const def = c.defaultOptionId;
      if (!def) continue;
      const opt = c.options.find((o) => o.id === def);
      out[c.id] = {
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
  frontSvg,
  backSvg,
  generating,
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
            <motion.div
              key="loading-front"
              className="flex aspect-[400/460] w-full items-center justify-center"
            >
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
            <motion.div
              key="loading-back"
              className="flex aspect-[400/460] w-full items-center justify-center"
            >
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
/*  AI render gallery (front / back / side)                     */
/* ============================================================ */

const RENDER_VIEW_ORDER = ["front", "back", "side"] as const;

// Merge a targeted gap-fill retry's fresh views into the existing set,
// keeping the fixed front/back/side order.
function mergeRenderViews(
  prev: MyodRenderView[],
  next: MyodRenderView[],
): MyodRenderView[] {
  const by = new Map(prev.map((v) => [v.view, v]));
  for (const v of next) by.set(v.view, v);
  return RENDER_VIEW_ORDER.filter((view) => by.has(view)).map(
    (view) => by.get(view) as MyodRenderView,
  );
}

function viewLabel(v: string) {
  return v.charAt(0).toUpperCase() + v.slice(1);
}

/**
 * Full-page takeover shown once the user taps "Generate Blouse": the finished
 * blouse as a slideshow — a preview strip of the three AI renders (front /
 * back / side) steers one big photo below, with arrows, swipe, and ←/→ keys
 * to move between views; tapping the big photo opens it fullscreen. Covers
 * the whole viewport — the configurator stays mounted underneath so "Keep
 * editing" drops straight back into the flow with all state and scroll
 * position intact. While rendering: branded skeletons. On failure: an
 * inline error with Retry (re-runs the render from the stored inputs — no
 * need to redo the SVG generate pass).
 */
function CompletionPage({
  views,
  phase,
  errorMessage,
  total,
  orderBusy,
  orderError,
  onCompleteOrder,
  onRetry,
  onRetryMissing,
  onKeepEditing,
  onRegenerate,
}: {
  views: MyodRenderView[];
  phase: "idle" | "rendering" | "done" | "error";
  /** Server-supplied reason (e.g. quota 503) — shown instead of the generic line. */
  errorMessage?: string | null;
  /** Running total carried from the wizard (base + selections). */
  total: number;
  /** Complete Order: creation in flight (spinner) / failure reason. */
  orderBusy?: boolean;
  orderError?: string | null;
  onCompleteOrder: () => void;
  onRetry: () => void;
  onRetryMissing: () => void;
  onKeepEditing: () => void;
  onRegenerate: () => void;
}) {
  // Which slide is shown big (front first, like the drawings).
  const [active, setActive] =
    useState<(typeof RENDER_VIEW_ORDER)[number]>("front");
  // Fullscreen viewer for one render (view key; null = closed).
  const [lightbox, setLightbox] = useState<string | null>(null);

  const shown = views.filter((v) => v.url);
  const current = shown.find((v) => v.view === lightbox);
  const step = (dir: 1 | -1) => {
    if (!current || shown.length < 2) return;
    const idx = shown.indexOf(current);
    setLightbox(shown[(idx + dir + shown.length) % shown.length].view);
  };
  const stepActive = (dir: 1 | -1) => {
    setActive((cur) => {
      const idx = RENDER_VIEW_ORDER.indexOf(cur);
      return RENDER_VIEW_ORDER[
        (idx + dir + RENDER_VIEW_ORDER.length) % RENDER_VIEW_ORDER.length
      ];
    });
  };

  // Horizontal swipe on the big photo (pointer events cover touch + mouse).
  // A short tap is NOT a swipe — it falls through to open the lightbox.
  const swipeX = useRef<number | null>(null);
  const swiped = useRef(false);
  const onSwipeStart = (e: React.PointerEvent) => {
    swipeX.current = e.clientX;
    swiped.current = false;
  };
  const onSwipeEnd = (e: React.PointerEvent) => {
    if (swipeX.current == null) return;
    const dx = e.clientX - swipeX.current;
    swipeX.current = null;
    if (Math.abs(dx) > 40) {
      swiped.current = true;
      stepActive(dx < 0 ? 1 : -1);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setLightbox(null);
        return;
      }
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const dir: 1 | -1 = e.key === "ArrowRight" ? 1 : -1;
      // Arrows drive the open lightbox first; otherwise the carousel.
      if (lightbox) step(dir);
      else stepActive(dir);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  // All three slots always exist so the layout never jumps when images
  // arrive — and a view the model dropped still holds its place with its
  // own retry instead of leaving a silent gap.
  const byView = new Map(views.map((v) => [v.view, v]));
  const tiles = RENDER_VIEW_ORDER.map((v) => ({
    view: v,
    url: byView.get(v)?.url ?? "",
  }));
  const activeTile = tiles.find((t) => t.view === active) ?? tiles[0];
  const busy = phase === "rendering";

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-warm-sand">
      {/* Slim navy header, same shape as the /myod page header */}
      <header className="relative flex flex-none flex-col justify-end overflow-hidden bg-ink-navy text-chalk-white">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full opacity-20 blur-md"
          style={{ background: "var(--tape-gradient)" }}
        />
        <div className="relative z-10 flex items-center gap-3 px-4 py-2.5">
          <span
            aria-hidden
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-chalk-white shadow-[0_1px_2px_rgba(208,96,16,0.3)]"
            style={{ backgroundImage: "var(--tape-gradient)" }}
          >
            <Check size={20} />
          </span>
          <div className="min-w-0">
            <span className="font-mono text-eyebrow font-medium uppercase tracking-[0.18em] text-chalk-white/80">
              MYOD
            </span>
            <h1 className="truncate font-heading text-h3 font-semibold leading-tight text-chalk-white">
              {strings.myod.finalTitle}
            </h1>
          </div>
        </div>
        {/* Tape-gradient seam (Brand Book §6) */}
        <div
          aria-hidden
          className="lp-tape-strip absolute inset-x-0 bottom-0 z-10"
        />
      </header>

      {/* Renders — slideshow: the preview strip steers, the big photo
          follows; arrows / swipe / ←→ switch views, tap for full size.
          The slide flexes to fill the space between strip and bottom bar so
          the whole photo + arrows are on screen without scrolling. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto flex min-h-0 w-full max-w-column flex-1 flex-col gap-3 px-4 pb-6 pt-4">
          <p className="text-center text-caption leading-snug text-muted">
            Every choice you made, reflected in three views of your blouse.
          </p>
          {/* The AI renders are a visual estimate — the stitched garment
              follows the recorded selections, not the image itself. */}
          <div className="flex w-full items-start gap-2 rounded-card border border-warning-border bg-warning-bg px-3 py-2 text-left">
            <Sparkles size={14} className="mt-0.5 flex-none text-warning" />
            <p className="text-caption leading-snug text-warning-text">
              {strings.myod.finalIndicativeNote}
            </p>
          </div>
          {phase === "error" ? (
            <div className="flex w-full items-center justify-between gap-2 rounded-card border border-error-border bg-error-bg px-3 py-2 text-left">
              <p className="text-caption text-error-text">
                {errorMessage || strings.myod.renderFailed}
              </p>
              <button
                type="button"
                onClick={onRetry}
                className="shrink-0 rounded-pill border border-error-border bg-chalk-white px-3 py-1 text-[12px] font-semibold text-error-text transition-all active:scale-[0.97]"
              >
                {strings.myod.renderRetry}
              </button>
            </div>
          ) : (
            <>
              {/* Preview strip — a centered filmstrip of true 3:4 thumbs (the
                  renders are 3:4) so nothing gets cropped; the selected view
                  carries the tape-orange ring. */}
              <div className="flex h-24 items-center justify-center gap-2">
                {tiles.map((v) => (
                  <button
                    key={v.view}
                    type="button"
                    onClick={() => setActive(v.view)}
                    aria-label={`Show ${viewLabel(v.view)} view`}
                    aria-pressed={active === v.view}
                    className={`relative aspect-[3/4] h-full touch-pan-y overflow-hidden rounded-card bg-mist-navy shadow-card transition-all ease-brand ${
                      active === v.view
                        ? "ring-2 ring-draep-orange ring-offset-2 ring-offset-warm-sand"
                        : "opacity-60 active:opacity-100"
                    }`}
                  >
                    {v.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={v.url}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : phase === "done" ? (
                      <span className="absolute inset-0 flex items-center justify-center px-1 text-center text-[9px] font-medium leading-tight text-muted">
                        {strings.myod.renderMissed}
                      </span>
                    ) : (
                      <span className="absolute inset-0 flex items-center justify-center">
                        <BrandSpinner size={14} />
                      </span>
                    )}
                    <span className="pointer-events-none absolute left-1.5 top-1.5 rounded-pill border border-white/10 bg-ink-navy px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-chalk-white">
                      {viewLabel(v.view)}
                    </span>
                  </button>
                ))}
              </div>

              {/* Big slide — the card itself is 3:4 like the render, sized by
                  the available height, so the photo fills it edge-to-edge
                  (no crops, no grey bars). Arrows flank OUTSIDE the photo. */}
              <div className="flex min-h-[220px] flex-1 items-center justify-center gap-2">
                <button
                  type="button"
                  aria-label="Previous view"
                  onClick={() => stepActive(-1)}
                  className="flex h-10 w-10 flex-none items-center justify-center rounded-full border border-hairline bg-chalk-white text-ink-navy shadow-card transition-all ease-brand active:scale-95"
                >
                  <ArrowLeft size={18} />
                </button>
                <div
                  className="relative aspect-[3/4] h-full max-w-full touch-pan-y select-none overflow-hidden rounded-card bg-mist-navy shadow-card"
                  onPointerDown={onSwipeStart}
                  onPointerUp={onSwipeEnd}
                >
                  {activeTile.url ? (
                    <button
                      type="button"
                      onClick={() => {
                        // A completed swipe shouldn't also open the lightbox.
                        if (swiped.current) {
                          swiped.current = false;
                          return;
                        }
                        setLightbox(active);
                      }}
                      aria-label={`Open ${viewLabel(active)} view full size`}
                      className="absolute inset-0 h-full w-full"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={activeTile.url}
                        alt={`${viewLabel(active)} view of the blouse`}
                        className="h-full w-full object-cover"
                        draggable={false}
                      />
                    </button>
                  ) : phase === "done" ? (
                    // The render finished but this view never landed — offer
                    // a targeted retry that fills only the gaps.
                    <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4">
                      <span className="text-center text-caption font-medium text-muted">
                        {strings.myod.renderMissed}
                      </span>
                      <button
                        type="button"
                        onClick={onRetryMissing}
                        disabled={busy}
                        className="rounded-pill border border-hairline-strong bg-chalk-white px-4 py-1.5 text-[12px] font-semibold text-ink-navy transition-all active:scale-[0.97] disabled:opacity-60"
                      >
                        {strings.myod.renderRetry}
                      </button>
                    </div>
                  ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-2">
                      <BrandSpinner size={22} />
                      <span className="text-caption text-muted">
                        {strings.myod.renderLoading}
                      </span>
                    </div>
                  )}
                  <div className="pointer-events-none absolute left-2 top-2 rounded-pill border border-white/10 bg-ink-navy px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-chalk-white shadow-[0_1px_2px_rgba(0,0,0,0.25)]">
                    {viewLabel(active)}
                  </div>
                </div>
                <button
                  type="button"
                  aria-label="Next view"
                  onClick={() => stepActive(1)}
                  className="flex h-10 w-10 flex-none items-center justify-center rounded-full border border-hairline bg-chalk-white text-ink-navy shadow-card transition-all ease-brand active:scale-95"
                >
                  <ArrowRight size={18} />
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Sticky order actions — Complete Order creates the pending order
          (selections + renders as inspiration images) and hands off to the
          /app order page for booking; Regenerate opens the refinement sheet
          (comment + previous renders fed back to the model). */}
      <div className="flex-none border-t border-hairline bg-chalk-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-column flex-col gap-2 px-4 py-3">
          {orderError && (
            <p className="rounded-card border border-error-border bg-error-bg px-3 py-2 text-caption text-error-text">
              {orderError}
            </p>
          )}
          <div className="flex items-baseline justify-between px-1">
            <span className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-muted">
              {strings.myod.estTotal}
            </span>
            <span className="font-heading text-h3 font-semibold leading-none text-ink-navy">
              {formatPrice(total)}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onRegenerate}
              disabled={busy || orderBusy}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-pill border border-hairline-strong bg-chalk-white px-2 text-caption font-semibold text-ink-navy transition-all ease-brand active:scale-[0.98] active:border-navy-interactive disabled:opacity-60"
            >
              {busy ? <BrandSpinner size={16} /> : <Sparkles size={16} />}
              {strings.myod.regenerate}
            </button>
            <button
              type="button"
              onClick={onCompleteOrder}
              disabled={orderBusy || busy || views.length === 0}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-pill px-2 text-caption font-semibold text-chalk-white shadow-brand transition-all ease-brand active:scale-[0.98] disabled:opacity-60"
              style={{ backgroundImage: "var(--tape-gradient)" }}
            >
              {orderBusy && <BrandSpinner size={16} />}
              {orderBusy ? "Creating order…" : strings.myod.completeOrder}
            </button>
          </div>
          <button
            type="button"
            onClick={onKeepEditing}
            className="mx-auto text-caption font-semibold text-navy-interactive underline-offset-4 transition-opacity ease-brand active:opacity-60"
          >
            {strings.myod.finalKeepEditing}
          </button>
        </div>
      </div>

      {/* Fullscreen render viewer */}
      {current && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${viewLabel(current.view)} view, full size`}
          className="fixed inset-0 z-50 flex flex-col bg-ink-navy"
        >
          <div className="flex flex-none items-center justify-between px-4 py-3">
            <span className="rounded-pill border border-white/10 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-chalk-white">
              {viewLabel(current.view)}
            </span>
            <button
              type="button"
              onClick={() => setLightbox(null)}
              aria-label="Close full size view"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white/10 text-chalk-white transition-all ease-brand active:scale-95 active:bg-white/20"
            >
              <Close size={18} />
            </button>
          </div>
          <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-4">
            {shown.length > 1 && (
              <button
                type="button"
                onClick={() => step(-1)}
                aria-label="Previous view"
                className="absolute left-1 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-white/10 text-chalk-white transition-all ease-brand active:scale-95 active:bg-white/20"
              >
                <ArrowLeft size={18} />
              </button>
            )}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={current.url}
              alt={`${viewLabel(current.view)} view of the blouse, full size`}
              className="max-h-full max-w-full rounded-card object-contain"
            />
            {shown.length > 1 && (
              <button
                type="button"
                onClick={() => step(1)}
                aria-label="Next view"
                className="absolute right-1 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-white/10 text-chalk-white transition-all ease-brand active:scale-95 active:bg-white/20"
              >
                <ArrowRight size={18} />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Regenerate sheet — the completion view's "Regenerate" flow. Collects an
 * optional comment, shows the renders being refined, and re-runs the render
 * with the previous images + comment fed back to the model as references.
 */
function RegenerateSheet({
  open,
  busy,
  previews,
  onClose,
  onConfirm,
}: {
  open: boolean;
  busy: boolean;
  previews: MyodRenderView[];
  onClose: () => void;
  onConfirm: (comment: string) => void;
}) {
  const [comment, setComment] = useState("");
  // Start fresh each time the sheet opens.
  useEffect(() => {
    if (open) setComment("");
  }, [open]);

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={strings.myod.regenTitle}
      footer={
        <button
          type="button"
          disabled={busy}
          onClick={() => onConfirm(comment.trim())}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-pill text-body font-semibold text-chalk-white shadow-brand transition-all ease-brand active:scale-[0.98] disabled:opacity-60"
          style={{ backgroundImage: "var(--tape-gradient)" }}
        >
          {busy ? <BrandSpinner size={18} /> : <Sparkles size={18} />}
          {strings.myod.regenCta}
        </button>
      }
    >
      <div className="flex flex-col gap-3 pb-4">
        {previews.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {previews.map((v) => (
              <div
                key={v.view}
                className="relative aspect-[3/4] overflow-hidden rounded-card bg-mist-navy"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={v.url}
                  alt=""
                  className="h-full w-full object-cover"
                />
                <div className="pointer-events-none absolute left-1.5 top-1.5 rounded-pill border border-white/10 bg-ink-navy px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-chalk-white">
                  {viewLabel(v.view)}
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="text-caption leading-snug text-muted">
          {strings.myod.regenBody}
        </p>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={3}
          maxLength={500}
          placeholder={strings.myod.regenPlaceholder}
          className="w-full resize-none rounded-card border border-hairline-strong bg-chalk-white px-3 py-2.5 text-body text-ink-navy placeholder:text-muted focus:border-navy-interactive focus:outline-none"
        />
      </div>
    </BottomSheet>
  );
}

/* ============================================================ */
/*  Step option cards (same as before)                         */
/* ============================================================ */

function StepCards({
  step,
  stepIndex,
  totalSteps,
  selections,
  disabled,
  generating,
  onBack,
  onSelect,
}: {
  step: DesignStep;
  stepIndex: number;
  totalSteps: number;
  selections: Selections;
  disabled: boolean;
  generating: boolean;
  onBack?: () => void;
  onSelect: (componentId: string, sel: ComponentSelection | null) => void;
}) {
  // Extras step has no counter (it's the open-ended final step).
  const showCounter = !step.isExtras && totalSteps > 1;
  return (
    <div>
      <div className="mb-3 px-1">
        <div className="flex min-h-[26px] items-center justify-between gap-3">
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              className="flex items-center gap-1 rounded-pill border border-hairline bg-chalk-white px-2.5 py-1 text-caption font-medium text-navy-interactive shadow-card transition-all ease-brand active:scale-[0.97] active:border-navy-interactive"
            >
              <ArrowLeft size={14} />
              <span>Back</span>
            </button>
          ) : (
            <span aria-hidden />
          )}
          {showCounter && (
            <span className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
              Step {stepIndex + 1} / {totalSteps}
            </span>
          )}
        </div>
        <span className="eyebrow">{strings.myod.chooseEyebrow}</span>
        <p className="mt-1 font-heading text-h3 font-semibold leading-snug text-ink-navy">
          {step.title}
        </p>
        <div className="mt-2 flex items-center gap-2" aria-hidden>
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-draep-orange shadow-[0_0_0_2px_rgba(248,144,16,0.22)]" />
          <span className="tick-divider flex-1" />
        </div>
      </div>

      {step.isExtras ? (
        <ExtrasList
          step={step}
          selections={selections}
          disabled={disabled}
          generating={generating}
          onSelect={onSelect}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {step.components.map((comp) => (
            <ComponentCards
              key={comp.id}
              component={comp}
              showLabel={step.components.length > 1}
              selection={selections[comp.id]}
              disabled={disabled}
              generating={generating}
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
  step,
  selections,
  disabled,
  generating,
  onSelect,
}: {
  step: DesignStep;
  selections: Selections;
  disabled: boolean;
  generating: boolean;
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
                onClear={(e) => {
                  e.stopPropagation();
                  onSelect(comp.id, null);
                }}
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
            generating={generating}
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
  component,
  selection,
  disabled,
  onOpen,
  onClear,
}: {
  component: StepComponent;
  selection: ComponentSelection | undefined;
  disabled: boolean;
  onOpen: () => void;
  onClear: (e: React.MouseEvent) => void;
}) {
  const isSet = !!selection;
  const chosenOpt = component.options.find(
    (o) => o.id === selection?.variationId,
  );
  const chosenSub = chosenOpt?.subOptions?.find(
    (s) => s.id === selection?.variationTypeId,
  );
  // Show a preview image even when unset: the chosen option's asset if set,
  // otherwise the first option's asset, otherwise the component/add-on's own
  // asset — bool add-ons have no options, so their image lives there.
  const thumbUrl =
    chosenOpt?.assetUrl ?? component.options[0]?.assetUrl ?? component.assetUrl;
  // Multi-spot add-on: name every spot's combination, "first +N more".
  const pickOpts = (selection?.picks ?? [])
    .map((p) => component.options.find((o) => o.id === p.variationId))
    .filter(Boolean) as StepOption[];
  const multiText =
    pickOpts.length > 1
      ? `${pickOpts[0].label} +${pickOpts.length - 1} more`
      : (pickOpts[0]?.label ?? "");
  const valueText = !isSet
    ? "Optional"
    : component.kind === "toggle"
      ? "On"
      : pickOpts.length > 0
        ? multiText
        : chosenOpt
          ? chosenSub
            ? `${chosenOpt.label} · ${chosenSub.label}`
            : chosenOpt.label
          : "Optional";
  // Placement suffix only when the value text doesn't already end with it
  // (Piping's variation labels ARE placements — "Front · Front" is noise).
  const placeText =
    selection?.placement &&
    !valueText
      .toLowerCase()
      .endsWith(placementLabel(selection.placement).toLowerCase())
      ? placementLabel(selection.placement)
      : null;

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onOpen}
      className={
        "group flex w-full items-center gap-3 rounded-card border bg-chalk-white p-2.5 text-left shadow-card transition-all ease-brand active:scale-[0.99] disabled:opacity-50 " +
        (isSet
          ? "border-accent-text/40"
          : "border-hairline active:border-navy-interactive active:shadow-brand")
      }
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
        <span className="text-body font-semibold leading-tight text-ink-navy">
          {component.label}
        </span>
        <span
          className={
            "truncate text-caption leading-snug " +
            (isSet ? "text-accent-text" : "text-muted")
          }
        >
          {valueText}
          {placeText ? ` · ${placeText}` : ""}
        </span>
      </div>

      {/* Clear (only when set) */}
      {isSet && (
        <span
          role="button"
          tabIndex={0}
          onClick={onClear}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onClear(e as unknown as React.MouseEvent);
            }
          }}
          aria-label={`Clear ${component.label}`}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted transition-all ease-brand active:scale-90 active:bg-mist-navy active:text-ink-navy"
        >
          <Close size={14} />
        </span>
      )}

      {/* What this selection adds to the total (omitted when it adds nothing) */}
      {isSet && selectionAmount(component, selection) > 0 && (
        <span className="shrink-0 font-mono text-caption font-semibold leading-tight text-accent-text">
          + {formatPrice(selectionAmount(component, selection))}
        </span>
      )}

      <ChevronRight
        size={18}
        className={
          "shrink-0 transition-transform " +
          (isSet ? "text-accent-text" : "text-muted")
        }
      />
    </button>
  );
}

/**
 * Rotating loader used in card corners while the AI renders a selection.
 * Framer-driven rotation with a tapered tape-colored arc — reads clearly as
 * a spinner at small sizes and keeps spinning even under CSS motion overrides.
 */
function BrandSpinner({ size = 16 }: { size?: number }) {
  return (
    <motion.span
      aria-hidden
      className="myod-brand-spinner inline-block rounded-full"
      style={{
        width: size,
        height: size,
        background:
          "conic-gradient(from 0deg, rgba(248,144,16,0) 0deg, #F89010 230deg, #D06010 360deg)",
        WebkitMask:
          "radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2.5px))",
        mask: "radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2.5px))",
      }}
      animate={{ rotate: 360 }}
      transition={{ repeat: Infinity, ease: "linear", duration: 0.7 }}
    />
  );
}

/**
 * Variation-type picker (variation_types — e.g. Strappy → Broad /
 * Thin-round). Opens as its own bottom sheet above whatever picker is
 * currently open (it renders fixed at the same z-50, later in the DOM, so
 * it stacks on top) and lays the types out as a 2-column grid of image
 * cards — photo, label, short description — mirroring the variation cards
 * it drills into. Picking a type fires onPick and the sheet closes;
 * dismissing picks nothing.
 */
function TypeSheet({
  variationLabel,
  subs,
  selectedId,
  disabled,
  onPick,
  onClose,
}: {
  variationLabel: string;
  subs: NonNullable<StepOption["subOptions"]>;
  selectedId: string | undefined;
  disabled?: boolean;
  onPick: (subId: string) => void;
  onClose: () => void;
}) {
  return (
    <BottomSheet open onClose={onClose} title={`Choose ${variationLabel} type`}>
      <div className="grid grid-cols-2 gap-2 pb-4">
        {subs.map((sub) => {
          const selected = sub.id === selectedId;
          return (
            <button
              key={sub.id}
              type="button"
              disabled={disabled}
              onClick={() => onPick(sub.id)}
              className={
                "group/sub flex flex-col overflow-hidden rounded-card border text-left transition-all ease-brand active:scale-[0.98] disabled:opacity-50 " +
                (selected
                  ? "border-accent-text bg-chalk-white shadow-card"
                  : "border-hairline bg-chalk-white active:border-navy-interactive")
              }
            >
              <div className="relative aspect-square w-full bg-mist-navy">
                {sub.assetUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={sub.assetUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <span className="font-heading text-h2 font-bold text-navy-interactive/25">
                      {sub.label.charAt(0).toUpperCase()}
                    </span>
                  </div>
                )}
                {selected && (
                  <span
                    className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full text-chalk-white shadow-[0_1px_2px_rgba(208,96,16,0.3)]"
                    style={{ backgroundImage: "var(--tape-gradient)" }}
                  >
                    <Check size={12} />
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-0.5 px-2 py-1.5">
                <span className="flex items-baseline justify-between gap-1.5 text-caption font-semibold leading-tight text-ink-navy">
                  <span className="min-w-0 truncate">{sub.label}</span>
                  <OptionPrice price={sub.price} />
                </span>
                {sub.description && (
                  <span className="line-clamp-2 text-[11px] leading-snug text-muted">
                    {sub.description}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </BottomSheet>
  );
}

/**
 * One value card in the axis wizard's 2-column grid: an image previewing the
 * variation the picks so far + this value resolve to, falling back to the
 * add-on's own asset while the catalog has no per-variation images (monogram
 * only if even that is missing), and a label. The selection indicator follows
 * the axis semantics: multi (placement) → check badge on picked values;
 * single-select axes → radio ring, shown on every card. No resolving
 * variation → the card disables (combination doesn't exist).
 */
function AxisValueCard({
  value,
  option,
  selected,
  disabled,
  multi,
  fallbackUrl,
  onClick,
}: {
  value: string;
  option: StepOption | undefined;
  selected: boolean;
  disabled?: boolean;
  multi?: boolean;
  fallbackUrl?: string;
  onClick: () => void;
}) {
  const img = option?.assetUrl ?? fallbackUrl;
  return (
    <button
      type="button"
      disabled={disabled || !option}
      onClick={onClick}
      className={
        "group/axis flex flex-col overflow-hidden rounded-card border text-left transition-all ease-brand active:scale-[0.98] disabled:opacity-40 " +
        (selected
          ? "border-accent-text bg-chalk-white shadow-card"
          : "border-hairline bg-chalk-white active:border-navy-interactive")
      }
    >
      <div className="relative h-28 w-full bg-mist-navy">
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={img}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="font-heading text-h2 font-bold text-navy-interactive/25">
              {value.charAt(0).toUpperCase()}
            </span>
          </div>
        )}
        {multi ? (
          selected && (
            <span
              className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full text-chalk-white shadow-[0_1px_2px_rgba(208,96,16,0.3)]"
              style={{ backgroundImage: "var(--tape-gradient)" }}
            >
              <Check size={12} />
            </span>
          )
        ) : (
          <span
            className={
              "absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full border-2 bg-chalk-white/90 shadow-[0_1px_2px_rgba(15,23,42,0.15)] " +
              (selected ? "border-accent-text" : "border-navy-interactive/30")
            }
          >
            {selected && (
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundImage: "var(--tape-gradient)" }}
              />
            )}
          </span>
        )}
      </div>
      <div className="px-2 py-1.5">
        <span className="flex items-baseline justify-between gap-1.5 text-caption font-semibold leading-tight text-ink-navy">
          <span className="min-w-0 truncate">
            {value.charAt(0).toUpperCase() + value.slice(1)}
          </span>
          <OptionPrice price={option?.price} />
        </span>
      </div>
    </button>
  );
}

/**
 * A stacked step sheet of the add-on axis wizard (ExtrasPicker): every axis
 * after the first — e.g. Shape, then Size — gets its own sheet with a preview
 * of what the picks so far resolve to and a 2-column grid of that axis's
 * value cards. Tapping a value reports to onPick (the picker advances to the
 * next axis or, on the last axis, commits); ✕ goes back one step.
 */
function AxisStepSheet({
  axisLabel,
  stepNumber,
  stepCount,
  cards,
  previewOption,
  caption,
  disabled,
  fallbackUrl,
  onPick,
  onBack,
}: {
  axisLabel: string;
  stepNumber: number;
  stepCount: number;
  cards: { value: string; selected: boolean; option: StepOption | undefined }[];
  previewOption: StepOption | undefined;
  caption: string;
  disabled?: boolean;
  fallbackUrl?: string;
  onPick: (value: string) => void;
  onBack: () => void;
}) {
  return (
    <BottomSheet open onClose={onBack} title={axisLabel}>
      <div className="flex flex-col gap-4 pb-2">
        <span className="eyebrow">
          Step {stepNumber} of {stepCount}
        </span>
        <div className="flex flex-col items-center gap-1.5">
          <div className="relative flex aspect-[4/3] w-full max-w-[200px] items-center justify-center overflow-hidden rounded-card bg-mist-navy">
            {(previewOption?.assetUrl ?? fallbackUrl) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewOption?.assetUrl ?? fallbackUrl}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="font-heading text-h1 font-bold text-navy-interactive/25">
                {(previewOption?.label ?? axisLabel).charAt(0).toUpperCase()}
              </span>
            )}
          </div>
          <span className="text-caption font-medium text-muted">{caption}</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {cards.map((c) => (
            <AxisValueCard
              key={c.value}
              value={c.value}
              option={c.option}
              selected={c.selected}
              disabled={disabled}
              fallbackUrl={fallbackUrl}
              onClick={() => onPick(c.value)}
            />
          ))}
        </div>
      </div>
    </BottomSheet>
  );
}

/**
 * The picker that lives inside the bottom sheet. Holds a LOCAL draft of the
 * selection (variation + sub-type + placement) so the user can set multiple
 * axes before committing. Modes by component shape: bool add-ons (enable +
 * place), axis-wizard add-ons (varying across 2+ axes — a step-by-step sheet
 * per axis in the order Where → Style → Type → Shape → Size → Color, only
 * the axes that actually vary; Where is multi-select with a Continue, the
 * rest single-select advancing on tap, last tap commits), placement-flat
 * add-ons (every option IS a spot — cards toggle multi-select, one pick per
 * spot), and everything else (image card per variation, with a type sheet
 * for typed ones).
 * Nothing is applied to the live design until the wizard/Confirm commits —
 * `onConfirm` fires once and the sheet closes.
 */
function ExtrasPicker({
  component,
  initialSelection,
  disabled,
  generating,
  onConfirm,
}: {
  component: StepComponent;
  initialSelection: ComponentSelection | undefined;
  disabled: boolean;
  generating?: boolean;
  onConfirm: (sel: ComponentSelection | null) => void;
}) {
  // Draft state — seeded from the current selection, else the catalog default
  // (is_default_on + default variation). Mirrors extrasDefaults: a toggle
  // starts ON only when default-on; a choice starts pre-highlighted on its
  // default variation (first variation for a default-on add-on without one);
  // anything else starts unset.
  const isToggle =
    component.kind === "toggle" || component.options.length === 0;
  const hasPlacement =
    !!component.placements && component.placements.length > 0;

  // Variation axes drive the axis wizard: add-ons varying across 2+ axes
  // (with or without a leading Where axis) step through one sheet per axis.
  // Placement-only add-ons (Piping, Lace Border — each variation IS a spot
  // with nothing else to pick) fall through to the plain card list, as does
  // anything varying across 0–1 axes.
  const allAxes = component.kind !== "toggle" ? (component.axes ?? []) : [];
  const whereAxis = allAxes[0]?.key === "where" ? allAxes[0] : undefined;
  const spotValues = whereAxis
    ? whereAxis.values
    : (component.placements ?? []);
  const whereOf = (opt: StepOption | undefined): string | undefined => {
    if (!opt) return undefined;
    return (
      opt.axisValues?.where ??
      spotValues.find((w) => w.toLowerCase() === opt.label.toLowerCase()) ??
      (component.options.length === 1 ? spotValues[0] : undefined)
    );
  };
  const defaultOpt =
    component.options.find((o) => o.id === component.defaultOptionId) ??
    (component.defaultOn ? component.options[0] : undefined);

  // Placement-flat add-on (e.g. Piping, Lace Border): every option card IS a
  // spot and nothing else varies. The card list runs as toggleable
  // multi-select — one add-on can sit on several spots at once (one pick per
  // spot, priced per spot, like the axis wizard's Where step).
  const placementFlat =
    !isToggle &&
    allAxes.length < 2 &&
    component.options.length > 1 &&
    component.options.every((o) =>
      (component.placements ?? []).some(
        (p) => p.toLowerCase() === o.label.toLowerCase(),
      ),
    );

  const [draft, setDraft] = useState<ComponentSelection | null>(() => {
    const base = initialSelection
      ? { ...initialSelection }
      : isToggle
        ? component.defaultOn
          ? hasPlacement
            ? {
                variationId: "__toggle_on__",
                placement: component.placements![0],
              }
            : { variationId: "__toggle_on__" }
          : null
        : defaultOpt
          ? {
              variationId: defaultOpt.id,
              variationTypeId: defaultOpt.defaultSubOptionId,
              ...(hasPlacement ? { placement: component.placements![0] } : {}),
            }
          : null;
    // Placement-flat: normalize a single-spot draft into a one-pick draft so
    // the card list can toggle spots uniformly through `picks`.
    if (!placementFlat || !base || base.picks?.length) return base;
    const spot = (component.placements ?? []).find(
      (p) =>
        p.toLowerCase() === (base.placement ?? "").toLowerCase() ||
        p.toLowerCase() ===
          (component.options.find((o) => o.id === base.variationId)?.label ??
            "").toLowerCase(),
    );
    return spot
      ? {
          variationId: base.variationId,
          picks: [{ variationId: base.variationId, placement: spot }],
        }
      : base;
  });

  // Variation whose type sheet is open (null = closed). Picking a type
  // writes it into the draft; dismissing keeps the draft untouched.
  const [typeOpt, setTypeOpt] = useState<StepOption | null>(null);

  // Axis-wizard step the picker is on (0 = this sheet's own content). Steps
  // ≥ 1 render as stacked sheets above, one axis each; ✕ on a step sheet
  // goes back one step.
  const [wizStep, setWizStep] = useState(0);

  // Per-axis picks for axis-wizard add-ons, seeded from the current
  // selection or the catalog default variation — not the first variation.
  const [axisSel, setAxisSel] = useState<Record<string, string>>(() => {
    const seed = component.options.find(
      (o) =>
        o.id === (initialSelection?.variationId ?? component.defaultOptionId),
    );
    return { ...(seed?.axisValues ?? {}) };
  });

  // Active placements for add-ons with a Where axis — ONE shared combination
  // is picked for every active spot (a key hole on the back and both
  // sleeves). Seeded from the selection's picks, else its single spot, else
  // the catalog default's spot.
  const [spots, setSpots] = useState<string[]>(() => {
    if (!whereAxis) return [];
    if (initialSelection?.picks?.length)
      return initialSelection.picks.map((p) => p.placement);
    const seedOpt = component.options.find(
      (o) =>
        o.id === (initialSelection?.variationId ?? component.defaultOptionId),
    );
    const w = whereOf(seedOpt);
    return w ? [w] : [];
  });

  // For toggle add-ons there are no option cards — the add-on's own asset
  // (when it has one) + enable/disable + place.
  if (isToggle) {
    const on = !!draft;
    const keepPlacement = draft?.placement ?? component.placements?.[0];
    return (
      <>
        <div className="flex flex-col gap-3 py-2">
          {component.assetUrl && (
            // Frame hugs the image (capped height, natural width, centered) —
            // addon assets are square, and a full-width cover strip crops them
            // to a sliver. Same treatment as the picker previews below.
            <div className="flex w-full justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={component.assetUrl}
                alt=""
                className="max-h-56 w-auto max-w-full rounded-card object-contain"
              />
            </div>
          )}
          <button
            type="button"
            disabled={disabled}
            onClick={() =>
              setDraft(
                on
                  ? null
                  : { variationId: "__toggle_on__", placement: keepPlacement },
              )
            }
            className={
              "flex items-center justify-between gap-3 rounded-card border bg-chalk-white p-3 text-left shadow-card transition-all ease-brand active:scale-[0.99] disabled:opacity-50 " +
              (on ? "border-accent-text/40" : "border-hairline")
            }
          >
            <span className="flex min-w-0 flex-1 items-baseline justify-between gap-2 text-body font-semibold text-ink-navy">
              <span className="min-w-0">
                {on ? "Enabled" : `Enable ${component.label}`}
              </span>
              <OptionPrice price={component.price} />
            </span>
            <span
              aria-hidden
              className="relative h-6 w-11 shrink-0 rounded-pill transition-colors ease-brand"
              style={
                on
                  ? { backgroundImage: "var(--tape-gradient)" }
                  : { backgroundColor: "var(--tape-silver)" }
              }
            >
              <span
                className={
                  "absolute top-0.5 h-5 w-5 rounded-full bg-chalk-white shadow transition-all ease-brand " +
                  (on ? "left-[22px]" : "left-0.5")
                }
              />
            </span>
          </button>
          {component.description && (
            <p className="px-1 text-caption leading-snug text-muted">
              {component.description}
            </p>
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
                  onSelect: (p: string) =>
                    setDraft((d) =>
                      d
                        ? { ...d, placement: p }
                        : { variationId: "__toggle_on__", placement: p },
                    ),
                  disabled,
                }
              : undefined
          }
        />
      </>
    );
  }

  // Axis wizard — any add-on varying across 2+ axes, with or without a
  // placement: a step-by-step sheet per axis in the order Where → Style →
  // Type → Shape → Size → Color, only the axes that actually vary. Step 0
  // renders in this sheet; each later axis opens its own sheet above. The
  // Where step is multi-select (a Continue advances); the rest are
  // single-select and advance on tap, with the last tap committing the
  // combination — one shared combo for every selected spot.
  if (allAxes.length >= 2) {
    const hostAxis = allAxes[0];
    const whereStep = hostAxis.key === "where";
    const stepAxis = allAxes[wizStep] ?? hostAxis;
    const restAxes = whereAxis ? allAxes.slice(1) : allAxes;
    // Partial match: axes the user hasn't stepped to yet don't constrain.
    const matchesPartial = (o: StepOption, override?: [string, string]) =>
      allAxes.every((a) => {
        if (a.key === "where") return true;
        const v = override?.[0] === a.key ? override[1] : axisSel[a.key];
        return v === undefined || o.axisValues?.[a.key] === v;
      });
    const atSpots = (o: StepOption) =>
      !whereAxis || spots.some((w) => whereOf(o) === w);
    const cardsFor = (
      axis: StepAxis,
    ): { value: string; option: StepOption | undefined }[] =>
      axis.key === "where"
        ? axis.values.map((val) => ({
            value: val,
            option: component.options.find(
              (o) => whereOf(o) === val && matchesPartial(o),
            ),
          }))
        : axis.values.map((val) => ({
            value: val,
            option: component.options.find(
              (o) => matchesPartial(o, [axis.key, val]) && atSpots(o),
            ),
          }));
    const previewOpt = component.options.find(
      (o) => matchesPartial(o) && atSpots(o),
    );
    const partialSummary = [
      ...(whereAxis && spots.length
        ? [spots.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" + ")]
        : []),
      ...restAxes
        .map((a) => axisSel[a.key])
        .filter(Boolean)
        .map((v) => v!.charAt(0).toUpperCase() + v!.slice(1)),
    ].join(" · ");
    const pickValue = (axis: StepAxis, value: string) => {
      const next = { ...axisSel, [axis.key]: value };
      setAxisSel(next);
      if (wizStep >= allAxes.length - 1) {
        // Last axis: resolve the full combination and commit.
        if (whereAxis) {
          const picks: PlacementPick[] = [];
          for (const w of spots) {
            const o = component.options.find(
              (opt) =>
                whereOf(opt) === w &&
                restAxes.every((a) => opt.axisValues?.[a.key] === next[a.key]),
            );
            if (o) picks.push({ variationId: o.id, placement: w });
          }
          if (picks.length)
            onConfirm({ variationId: picks[0].variationId, picks });
        } else {
          const o = component.options.find((opt) =>
            restAxes.every((a) => opt.axisValues?.[a.key] === next[a.key]),
          );
          if (o) onConfirm({ ...draft, variationId: o.id });
        }
      } else {
        setWizStep(wizStep + 1);
      }
    };
    return (
      <>
        <div className="flex flex-col gap-4 py-2">
          {(previewOpt?.assetUrl ?? component.assetUrl) && (
            <div className="flex w-full justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewOpt?.assetUrl ?? component.assetUrl}
                alt=""
                className="max-h-32 w-auto max-w-full rounded-card object-contain"
              />
            </div>
          )}
          {component.description && (
            <p className="px-1 text-caption leading-snug text-muted">
              {component.description}
            </p>
          )}
          <div className="flex flex-col gap-2">
            <span className="eyebrow px-1">{hostAxis.label}</span>
            <div className="grid grid-cols-2 gap-2">
              {cardsFor(hostAxis).map(({ value, option }) => (
                <AxisValueCard
                  key={value}
                  value={value}
                  option={option}
                  selected={
                    whereStep
                      ? spots.includes(value)
                      : axisSel[hostAxis.key] === value
                  }
                  disabled={disabled}
                  multi={whereStep}
                  fallbackUrl={component.assetUrl}
                  onClick={() =>
                    whereStep
                      ? setSpots((prev) =>
                          prev.includes(value)
                            ? prev.filter((v) => v !== value)
                            : [...prev, value],
                        )
                      : pickValue(hostAxis, value)
                  }
                />
              ))}
            </div>
          </div>
        </div>
        {whereStep ? (
          <PickerFooter
            canConfirm={spots.length > 0}
            onConfirm={() => setWizStep(1)}
            confirmLabel="Continue"
          />
        ) : null}
        {wizStep >= 1 ? (
          <AxisStepSheet
            key={stepAxis.key}
            axisLabel={stepAxis.label}
            stepNumber={wizStep + 1}
            stepCount={allAxes.length}
            cards={cardsFor(stepAxis).map((c) => ({
              ...c,
              selected: axisSel[stepAxis.key] === c.value,
            }))}
            previewOption={previewOpt}
            caption={partialSummary}
            disabled={disabled}
            fallbackUrl={component.assetUrl}
            onPick={(v) => pickValue(stepAxis, v)}
            onBack={() => setWizStep(wizStep - 1)}
          />
        ) : null}
      </>
    );
  }

  // Choice component (no placement, ≤1 varying axis): one image card per
  // variation + a type bottom-sheet for variations with types — the
  // Latkan-style list.
  const selectedId = draft?.variationId;
  const canConfirm = !!draft;

  return (
    <>
      <div className="flex flex-col gap-2.5 py-2">
        {component.options.map((opt) => {
          const selected = placementFlat
            ? !!draft?.picks?.some((p) => p.variationId === opt.id)
            : opt.id === selectedId;
          const chosenSub = opt.subOptions?.find(
            (s) => s.id === draft?.variationTypeId,
          );
          return (
            <div
              key={opt.id}
              className={
                "group relative flex w-full flex-row items-stretch overflow-hidden rounded-card border text-left transition-all ease-brand disabled:opacity-50 " +
                (selected
                  ? "border-accent-text bg-chalk-white shadow-card"
                  : "border-hairline bg-chalk-white shadow-card active:border-navy-interactive active:shadow-brand")
              }
            >
              {selected && (
                <span aria-hidden className="absolute right-2 top-2 z-10">
                  {generating ? (
                    <BrandSpinner size={18} />
                  ) : (
                    <span
                      className="flex h-5 w-5 items-center justify-center rounded-full text-chalk-white shadow-[0_1px_2px_rgba(208,96,16,0.3)]"
                      style={{ backgroundImage: "var(--tape-gradient)" }}
                    >
                      <Check size={12} />
                    </span>
                  )}
                </span>
              )}
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  // Placement-flat: cards are spots — tapping toggles the
                  // spot in/out (multi-select; Confirm commits all picked
                  // spots, priced per spot).
                  if (placementFlat) {
                    setDraft((d) => {
                      const picks = d?.picks ?? [];
                      const next = picks.some((p) => p.variationId === opt.id)
                        ? picks.filter((p) => p.variationId !== opt.id)
                        : [
                            ...picks,
                            {
                              variationId: opt.id,
                              placement: whereOf(opt) ?? opt.label,
                            },
                          ];
                      return next.length
                        ? { variationId: next[0].variationId, picks: next }
                        : null;
                    });
                    return;
                  }
                  // Variations with types (e.g. Shoulder → Strappy) drill
                  // into a type bottom-sheet instead of selecting outright.
                  if (opt.subOptions?.length) {
                    setTypeOpt(opt);
                    return;
                  }
                  setDraft({
                    variationId: opt.id,
                    // Placement-bearing flat add-ons (Piping): each card IS
                    // a placement, so sync it; others keep the seeded one.
                    placement:
                      component.placements?.find(
                        (p) => p.toLowerCase() === opt.label.toLowerCase(),
                      ) ?? draft?.placement,
                  });
                }}
                className="flex w-full flex-row items-stretch text-left active:scale-[0.99]"
              >
                {/* Reference image — left */}
                <div className="relative aspect-square w-24 shrink-0 overflow-hidden bg-mist-navy">
                  {opt.assetUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={opt.assetUrl}
                      alt=""
                      className="h-full w-full object-cover"
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
                  <span className="flex items-baseline justify-between gap-2 text-body font-semibold leading-tight text-ink-navy">
                    <span className="min-w-0">{opt.label}</span>
                    <OptionPrice price={opt.price} />
                  </span>
                  {opt.description && (
                    <span className="line-clamp-3 text-caption leading-snug text-muted">
                      {opt.description}
                    </span>
                  )}
                  {selected && chosenSub && (
                    <span className="text-[11px] font-medium leading-snug text-accent-text">
                      Type: {chosenSub.label}
                      {chosenSub.price
                        ? ` · + ${formatPrice(chosenSub.price)}`
                        : ""}
                    </span>
                  )}
                </div>
              </button>
            </div>
          );
        })}
      </div>

      {/* Type picker — a sheet stacked above this one */}
      {typeOpt?.subOptions?.length ? (
        <TypeSheet
          variationLabel={typeOpt.label}
          subs={typeOpt.subOptions}
          selectedId={draft?.variationTypeId}
          disabled={disabled}
          onClose={() => setTypeOpt(null)}
          onPick={(subId) => {
            setDraft({
              variationId: typeOpt.id,
              variationTypeId: subId,
              placement:
                component.placements?.find(
                  (p) => p.toLowerCase() === typeOpt.label.toLowerCase(),
                ) ?? draft?.placement,
            });
            setTypeOpt(null);
          }}
        />
      ) : null}
      <PickerFooter
        canConfirm={canConfirm}
        onConfirm={() => onConfirm(draft)}
        confirmLabel={strings.myod.done}
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
  canConfirm,
  onConfirm,
  confirmLabel,
  placementProps,
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
          <span className="self-center font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
            Place on
          </span>
          {placementProps.placements.map((p) => {
            const sel = placementProps.value === p;
            return (
              <button
                key={p}
                type="button"
                disabled={placementProps.disabled}
                onClick={() => placementProps.onSelect(p)}
                className={
                  "rounded-pill border px-2.5 py-1 text-caption leading-tight transition-all ease-brand active:scale-[0.97] disabled:opacity-50 " +
                  (sel
                    ? "border-transparent bg-tape text-chalk-white"
                    : "border-hairline-strong bg-chalk-white text-ink active:border-navy-interactive")
                }
                style={
                  sel ? { backgroundImage: "var(--tape-gradient)" } : undefined
                }
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
          className="rounded-pill bg-tape px-5 py-2.5 text-body font-semibold text-chalk-white shadow-primary transition-all ease-brand active:scale-[0.98] disabled:opacity-50"
          style={{ backgroundImage: "var(--tape-gradient)" }}
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}

function ToggleCard({
  component,
  showLabel,
  selection,
  disabled,
  onSelect,
}: {
  component: {
    id: string;
    label: string;
    kind?: "choice" | "toggle";
    price?: number;
  };
  showLabel: boolean;
  selection: ComponentSelection | undefined;
  disabled: boolean;
  onSelect: (sel: ComponentSelection | null) => void;
}) {
  const on = !!selection && selection.variationId === "__toggle_on__";
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
        onClick={() => onSelect(on ? null : { variationId: "__toggle_on__" })}
        className="flex w-full items-center justify-between gap-2 rounded-card border border-hairline bg-chalk-white px-3 py-2.5 text-left shadow-card transition-all ease-brand active:scale-[0.99] disabled:opacity-50"
      >
        <span className="flex min-w-0 flex-1 items-baseline justify-between gap-2">
          <span className="text-caption font-medium text-ink-navy">
            {component.label}
          </span>
          <OptionPrice price={component.price} />
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

function ComponentCards({
  component,
  showLabel,
  selection,
  disabled,
  generating,
  onSelect,
}: {
  component: {
    id: string;
    label: string;
    options: StepOption[];
    kind?: "choice" | "toggle";
    price?: number;
  };
  showLabel: boolean;
  selection: ComponentSelection | undefined;
  disabled: boolean;
  generating?: boolean;
  onSelect: (sel: ComponentSelection) => void;
}) {
  const selectedId = selection?.variationId;
  // Variation whose type sheet is open (null = closed). Tapping a variation
  // with types opens the sheet instead of selecting outright.
  const [typeOpt, setTypeOpt] = useState<StepOption | null>(null);

  if (component.kind === "toggle") {
    return (
      <ToggleCard
        component={component}
        showLabel={showLabel}
        selection={selection}
        disabled={disabled}
        onSelect={onSelect as (sel: ComponentSelection | null) => void}
      />
    );
  }
  return (
    <div>
      {showLabel && (
        <p className="mb-1.5 px-1 font-mono text-eyebrow font-medium uppercase tracking-[0.18em] text-muted">
          {component.label}
        </p>
      )}
      <div className="flex flex-col gap-2">
        {component.options.map((opt) => {
          const selected = opt.id === selectedId;
          // Chosen type, shown on the card once selected (Hook → Front hook).
          const chosenSub = opt.subOptions?.find(
            (s) => s.id === selection?.variationTypeId,
          );
          return (
            <div
              key={opt.id}
              className={
                "group relative flex w-full flex-row items-stretch overflow-hidden rounded-card border text-left transition-all ease-brand disabled:opacity-50 " +
                (selected
                  ? "border-accent-text bg-chalk-white shadow-card"
                  : "border-hairline bg-chalk-white shadow-card active:border-navy-interactive active:shadow-brand")
              }
            >
              {selected && (
                <span aria-hidden className="absolute right-2 top-2 z-10">
                  {generating ? (
                    <BrandSpinner size={16} />
                  ) : (
                    <span className="block h-2 w-2 rounded-full bg-draep-orange shadow-[0_0_0_2px_rgba(248,144,16,0.22)]" />
                  )}
                </span>
              )}

              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  // Variations with types (e.g. Tying mechanism → Hook) open
                  // the type bottom-sheet instead of selecting outright.
                  if (opt.subOptions?.length) {
                    setTypeOpt(opt);
                    return;
                  }
                  onSelect({ variationId: opt.id });
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
                      className="h-full w-full object-cover"
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
                  <span className="flex items-baseline justify-between gap-2 text-body font-semibold leading-tight text-ink-navy">
                    <span className="min-w-0">{opt.label}</span>
                    <OptionPrice price={opt.price} />
                  </span>
                  {opt.description && (
                    <span className="line-clamp-3 text-caption leading-snug text-muted">
                      {opt.description}
                    </span>
                  )}
                  {selected && chosenSub && (
                    <span className="text-[11px] font-medium leading-snug text-accent-text">
                      Type: {chosenSub.label}
                      {chosenSub.price
                        ? ` · + ${formatPrice(chosenSub.price)}`
                        : ""}
                    </span>
                  )}
                </div>
              </button>
            </div>
          );
        })}
      </div>

      {/* Type picker bottom-sheet */}
      {typeOpt?.subOptions?.length ? (
        <TypeSheet
          variationLabel={typeOpt.label}
          subs={typeOpt.subOptions}
          selectedId={
            selectedId === typeOpt.id ? selection?.variationTypeId : undefined
          }
          disabled={disabled}
          onClose={() => setTypeOpt(null)}
          onPick={(subId) => {
            onSelect({
              variationId: typeOpt.id,
              variationTypeId: subId,
            });
            setTypeOpt(null);
          }}
        />
      ) : null}
    </div>
  );
}

/* ============================================================ */
/*  Loading / generating / error                                */
/* ============================================================ */

function GeneratingLoader() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="relative flex flex-col items-center gap-4"
    >
      <div className="relative flex h-28 w-28 items-center justify-center">
        <motion.div
          aria-hidden
          className="absolute inset-0 rounded-full bg-draep-orange/15 blur-3xl"
          animate={{ opacity: [0.5, 0.85, 0.5] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          aria-hidden
          className="absolute inset-7 rounded-full opacity-95"
          style={{ backgroundImage: "var(--tape-gradient)" }}
          animate={{ scale: [1, 1.12, 1], opacity: [0.85, 1, 0.85] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
        />
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            aria-hidden
            className="absolute h-2.5 w-2.5 rounded-full bg-chalk-white shadow"
            style={{ offsetPath: "path('M 56 14 A 42 42 0 1 1 55.9 14 Z')" }}
            animate={{ offsetDistance: ["0%", "100%"] }}
            transition={{
              duration: 2.2,
              repeat: Infinity,
              ease: "linear",
              delay: i * 0.73,
            }}
          />
        ))}
        <Sparkles size={24} className="relative z-10 text-chalk-white" />
      </div>
      <motion.p
        className="font-heading text-h3 font-semibold text-ink-navy"
        animate={{ opacity: [0.65, 1, 0.65] }}
        transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
      >
        {strings.myod.generating}
      </motion.p>
      <div className="h-1.5 w-36 overflow-hidden rounded-pill bg-tape-silver">
        <div
          className="h-full rounded-full"
          style={{
            width: "100%",
            transform: "scaleX(0)",
            transformOrigin: "left",
            backgroundImage: "var(--tape-gradient)",
            animation: "myod-progress-fill 60s linear forwards",
          }}
        />
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
      className="flex h-[40vh] flex-col items-center justify-center gap-3 text-muted"
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

function ErrorStage({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
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
      <p className="font-heading text-h3 font-semibold text-ink-navy">
        {strings.myod.errorTitle}
      </p>
      <p className="text-body text-muted">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-1 rounded-pill bg-tape px-5 py-2.5 text-body font-semibold text-chalk-white shadow-primary transition-all ease-brand active:scale-[0.98]"
        style={{ backgroundImage: "var(--tape-gradient)" }}
      >
        {strings.myod.errorRetry}
      </button>
    </motion.div>
  );
}

export { labelText };
