"use client";

/**
 * WalkInConfigurator — full-screen step-by-step garment configuration for
 * the style-captain walk-in flow. Renders the exact customer /create (MYOD)
 * experience — one step at a time, photo cards with descriptions, the
 * captain holds the screen up to the customer. Tapping an option advances;
 * the last step carries Done in the header (no bottom bar).
 *
 * Two modes:
 *  - CREATE (no garmentOrderId): nothing exists server-side yet — Done adds
 *    the garment with the FINAL selections in one call (no default rows are
 *    materialized and later overwritten; abandoning the flow leaves no data).
 *  - EDIT (garmentOrderId + rows): the snapshot's rows seed the selections
 *    and Done diffs against them (PUT variation swaps; DELETE/POST/PUT
 *    add-on rows), same operation order as the old sheet (deletes → adds →
 *    puts) so placement slots free up before re-adds.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { StepCards, extrasDefaults } from "@/components/myod/MyodSheet";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { getGarmentTree } from "@/lib/api/catalog";
import { criticalDefaults } from "@/lib/walkin-defaults";
import {
  buildDesignSteps,
  labelText,
  type ComponentSelection,
  type DesignStep,
  type PlacementPick,
  type Selections,
  type StepComponent,
} from "@/lib/myod-steps";
import {
  scAddAddon,
  scRemoveAddonItem,
  scUpdateSelection,
  scWalkInAddGarment,
  scWalkInOrderWithGarment,
  type SCAvailableAddon,
  type SCSelection,
  type SCWalkInSelectionsPayload,
} from "@/lib/style-captain-api";
import type { GarmentTreeOut } from "@/types/api";

type Phase = "loading-tree" | "ready" | "error";

/**
 * Seed MYOD-style selections from snapshot rows (EDIT mode): one selection
 * per variation component, one pick per add-on row (grouped per add-on so a
 * placement add-on with rows on several spots round-trips as `picks`).
 * Keys are catalog component / add-on ids — the same ids buildDesignSteps
 * keys its steps by, so the seeded values highlight the right cards.
 */
function seedSelections(rows: SCSelection[]): Selections {
  const out: Selections = {};
  for (const row of rows) {
    if (row.type === "variation" && row.component && row.variation) {
      out[row.component.id] = {
        variationId: row.variation.id,
        ...(row.variation_type ? { variationTypeId: row.variation_type.id } : {}),
      };
    }
  }
  for (const row of rows) {
    if (row.type === "add_on" && row.addon && row.addon_variation) {
      const pick: PlacementPick = {
        variationId: row.addon_variation.id,
        placement: row.placement?.[0] ?? "",
      };
      const prev = out[row.addon.id];
      out[row.addon.id] = prev?.picks?.length
        ? { ...prev, picks: [...prev.picks, pick] }
        : {
            variationId: pick.variationId,
            ...(pick.placement ? { placement: pick.placement } : {}),
          };
    }
  }
  return out;
}

/**
 * Serialize the MYOD-style selections for the add-with-selections endpoint —
 * same shape the /create "add to order" path sends. Critical components the
 * captain skipped (via back-navigation) resolve to their catalog default so
 * the created rows stay complete; opt-in extras stay opt-in; the toggle
 * sentinel resolves to the add-on's default variation.
 */
function serializeSelections(
  steps: DesignStep[],
  selections: Selections,
): SCWalkInSelectionsPayload {
  const out: SCWalkInSelectionsPayload = {};
  const pick = (c: StepComponent): ComponentSelection | null => {
    const sel = selections[c.id];
    if (sel) return sel;
    // Un-touched critical component → catalog default.
    const def = c.defaultOptionId;
    if (!c.section && def) {
      const opt = c.options.find((o) => o.id === def);
      return { variationId: def, ...(opt?.defaultSubOptionId ? { variationTypeId: opt.defaultSubOptionId } : {}) };
    }
    return null;
  };
  for (const step of steps) {
    for (const c of step.components) {
      const sel = pick(c);
      if (!sel) continue;
      const resolveId = (id: string) =>
        id === "__toggle_on__" ? (c.defaultOptionId ?? c.options[0]?.id ?? id) : id;
      if (sel.picks?.length) {
        const picks = sel.picks
          .filter((p) => p.variationId && p.variationId !== "__toggle_on__")
          .map((p) => ({
            variation_id: p.variationId,
            ...(p.variationTypeId ? { variation_type_id: p.variationTypeId } : {}),
            ...(p.placement ? { placement: p.placement } : {}),
          }));
        if (picks.length) {
          out[c.id] = { variation_id: picks[0].variation_id, picks };
          continue;
        }
      }
      const variationId = resolveId(sel.variationId);
      if (!variationId || variationId === "__toggle_on__") continue; // bool add-on — nothing to serialize
      out[c.id] = {
        variation_id: variationId,
        ...(sel.variationTypeId ? { variation_type_id: sel.variationTypeId } : {}),
        ...(sel.placement ? { placement: sel.placement } : {}),
      };
    }
  }
  return out;
}

export function WalkInConfigurator({
  garmentId,
  garmentOrderId,
  order,
  selections: rows,
  availableAddons,
  onClose,
  onDone,
}: {
  /** Catalog garment id — the tree to configure. */
  garmentId: string;
  /** EDIT mode: the saved garment_order being edited. Omit for CREATE. */
  garmentOrderId?: string;
  /** CREATE mode: the walk-in order to add the garment to — either an
   *  existing order, or the confirmed user (+ chosen address) when this is
   *  the FIRST garment (Done then creates the pending order + address +
   *  garment together). */
  order?:
    | { orderId: string }
    | {
        create: {
          userId: string;
          address: { addressId: string } | { newAddress: unknown } | null;
        };
      };
  /** EDIT mode: snapshot rows the server materialized. */
  selections?: SCSelection[];
  /** EDIT mode: catalog add-ons offered for this garment. */
  availableAddons?: SCAvailableAddon[];
  /** Cancel — CREATE leaves nothing behind; EDIT keeps server rows. */
  onClose: () => void;
  /** Called after Done saves (EDIT) or adds (CREATE) — carries the order
   *  ids when Done created the order (first garment). */
  onDone: (created?: { orderId: string; orderNumber: string }) => void;
}) {
  const editMode = Boolean(garmentOrderId);
  const [phase, setPhase] = useState<Phase>("loading-tree");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [tree, setTree] = useState<GarmentTreeOut | null>(null);
  const steps = useMemo(() => (tree ? buildDesignSteps(tree) : []), [tree]);
  const [activeStepIdx, setActiveStepIdx] = useState(0);
  const [selections, setSelections] = useState<Selections>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Load the design tree (same public call /myod mounts), seeding selections:
  // EDIT from the server rows, CREATE from the catalog's extras defaults.
  const seededRef = useRef(false);
  const loadTree = useCallback(async () => {
    setPhase("loading-tree");
    setErrorMsg(null);
    try {
      const t = await getGarmentTree(garmentId);
      setTree(t);
      if (!seededRef.current) {
        if (editMode && rows) {
          setSelections(seedSelections(rows));
        } else {
          // Show catalog defaults the way /create shows a chosen option:
          // pre-selected — critical steps on their default variation, extras
          // on their default-on rows. No custom badge anywhere.
          const built = buildDesignSteps(t);
          setSelections({ ...criticalDefaults(built), ...extrasDefaults(built) });
        }
        seededRef.current = true;
      }
      setPhase("ready");
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Couldn't load the design options.",
      );
      setPhase("error");
    }
  }, [garmentId, editMode, rows]);
  useEffect(() => {
    void loadTree();
  }, [loadTree]);

  const activeStep: DesignStep | undefined = steps[activeStepIdx];
  const onLastStep = activeStepIdx >= steps.length - 1;

  // Fresh step, fresh scroll: reset the sheet's own scroll container (the
  // nearest overflow-y-auto ancestor of the step banner).
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    rootRef.current
      ?.closest(".overflow-y-auto")
      ?.scrollTo({ top: 0 });
  }, [activeStepIdx]);

  function handleSelectOption(componentId: string, sel: ComponentSelection | null) {
    const next = { ...selections };
    if (sel) next[componentId] = sel;
    else delete next[componentId];
    setSelections(next);
    // Same interaction as /create: a choice-step tap advances; the extras
    // step collects several picks before Done.
    const step = steps[activeStepIdx];
    if (!step?.isExtras) {
      const tappedIdx = activeStepIdx;
      setActiveStepIdx((i) =>
        i === tappedIdx ? Math.min(steps.length - 1, i + 1) : i,
      );
    }
  }

  /** CREATE: add the garment with the final selections in one call — to
   *  the existing order, or as the FIRST garment which creates the pending
   *  order together with it. */
  async function createWithSelections() {
    if (!order || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      if ("orderId" in order) {
        await scWalkInAddGarment(order.orderId, garmentId, serializeSelections(steps, selections));
        onDone();
      } else {
        const res = await scWalkInOrderWithGarment({
          user_id: order.create.userId,
          ...("addressId" in (order.create.address ?? {})
            ? { address_id: (order.create.address as { addressId: string }).addressId }
            : {}),
          ...("newAddress" in (order.create.address ?? {})
            ? { new_address: (order.create.address as { newAddress: unknown }).newAddress as never }
            : {}),
          garment_id: garmentId,
          selections: serializeSelections(steps, selections),
        });
        onDone({ orderId: res.order_id, orderNumber: res.order_number });
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save the design");
    } finally {
      setSaving(false);
    }
  }

  /** EDIT mode's desired picks from the MYOD-style state. */
  function desiredPicks(addonId: string): ComponentSelection[] {
    const s = selections[addonId];
    if (!s) return [];
    return s.picks?.length ? s.picks : [s];
  }

  /** EDIT: diff selections vs the snapshot rows → row-level ops. */
  async function saveEdits() {
    if (!garmentOrderId || saving) return;
    const snapRows = rows ?? [];
    const addons = availableAddons ?? [];
    setSaving(true);
    setSaveError(null);
    try {
      // Deletes → adds → puts (a freed addon+placement slot must exist
      // before the re-add lands in it).

      // Variation rows the wizard changed → PUT the new variation (+type).
      const variationChanges: { itemId: string; variationId: string; typeId: string | null }[] = [];
      for (const row of snapRows) {
        if (row.type !== "variation" || !row.component || !row.variation) continue;
        const sel = selections[row.component.id];
        if (!sel) continue;
        const typeId = sel.variationTypeId ?? null;
        if (sel.variationId !== row.variation.id || typeId !== (row.variation_type?.id ?? null)) {
          variationChanges.push({ itemId: row.item_id, variationId: sel.variationId, typeId });
        }
      }

      type Op =
        | { kind: "delete"; itemId: string }
        | { kind: "post"; addonId: string; variationId: string | null; placement: string | null }
        | { kind: "put"; itemId: string; variationId: string };
      const ops: Op[] = [];
      for (const a of addons) {
        const addonRows = snapRows.filter(
          (r) => r.type === "add_on" && r.addon?.id === a.addon.id,
        );
        const varById = new Map(a.variations.map((v) => [v.id, v]));

        // Boolean add-on (no variations): any selection = on, none = off.
        if (a.variations.length === 0) {
          const s = selections[a.addon.id];
          if (s) {
            if (addonRows.length === 0) {
              ops.push({
                kind: "post",
                addonId: a.addon.id,
                variationId: null,
                placement: s.placement ?? a.placements?.[0] ?? null,
              });
            }
          } else {
            for (const row of addonRows) ops.push({ kind: "delete", itemId: row.item_id });
          }
          continue;
        }

        const desired = desiredPicks(a.addon.id);
        for (let i = addonRows.length - 1; i >= desired.length; i--) {
          ops.push({ kind: "delete", itemId: addonRows[i].item_id });
        }
        for (let i = 0; i < desired.length; i++) {
          const wanted = desired[i];
          const row = addonRows[i];
          const variationId =
            wanted.variationId === "__toggle_on__"
              ? (a.default_variation_id ?? a.variations[0]?.id ?? null)
              : varById.has(wanted.variationId)
                ? wanted.variationId
                : (a.default_variation_id ?? a.variations[0]?.id ?? null);
          if (!variationId) continue;
          const variation = varById.get(variationId) ?? null;
          if (row) {
            if (row.addon_variation?.id === variationId) continue;
            const rowPl = row.placement?.[0] ?? null;
            if (variation && (variation.placement === null || variation.placement === rowPl)) {
              ops.push({ kind: "put", itemId: row.item_id, variationId });
            } else {
              ops.push({ kind: "delete", itemId: row.item_id });
              ops.push({
                kind: "post",
                addonId: a.addon.id,
                variationId,
                placement: variation?.placement ?? rowPl,
              });
            }
          } else {
            ops.push({
              kind: "post",
              addonId: a.addon.id,
              variationId,
              placement: variation?.placement ?? (wanted.placement || null),
            });
          }
        }
      }

      for (const op of ops) {
        if (op.kind === "delete") await scRemoveAddonItem(garmentOrderId, op.itemId);
      }
      for (const op of ops) {
        if (op.kind === "post") {
          await scAddAddon(garmentOrderId, {
            addon_id: op.addonId,
            addon_variation_id: op.variationId,
            placement: op.placement,
          });
        }
      }
      for (const op of ops) {
        if (op.kind === "put") {
          await scUpdateSelection(garmentOrderId, op.itemId, {
            addon_variation_id: op.variationId,
          });
        }
      }
      for (const ch of variationChanges) {
        await scUpdateSelection(garmentOrderId, ch.itemId, {
          variation_id: ch.variationId,
          variation_type_id: ch.typeId,
        });
      }
      onDone();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save selections");
    } finally {
      setSaving(false);
    }
  }

  // ── Render — the whole flow lives in a bottom sheet until the garment is
  // added to the order (same step-by-step flow as /create; tapping an option
  // advances; Done appears in the sheet footer on the last step) ────────────

  const garmentTitle = tree ? labelText(tree.labels) || "Configure garment" : "Configure garment";

  return (
    <BottomSheet
      open
      onClose={saving ? () => {} : onClose}
      title={garmentTitle}
      footer={
        onLastStep ? (
          <button
            type="button"
            data-testid="wi-config-done"
            onClick={() => void (editMode ? saveEdits() : createWithSelections())}
            disabled={saving}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-pill text-body font-semibold text-chalk-white shadow-brand transition-all ease-brand active:scale-[0.98] disabled:opacity-60"
            style={{ backgroundImage: "var(--tape-gradient)" }}
          >
            {saving && (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-chalk-white border-t-transparent" />
            )}
            {saving ? "Adding to order…" : editMode ? "Done" : "Add to Order"}
          </button>
        ) : undefined
      }
    >
      {/* Step banner: counter + progress dots */}
      <div ref={rootRef} className="flex flex-col gap-1 pb-3 pt-1">
        {activeStep && (
          <>
            <span
              data-testid="wi-step-counter"
              className="font-mono text-eyebrow font-medium uppercase tracking-[0.18em] text-accent-text"
            >
              {`Step ${activeStepIdx + 1} / ${steps.length}`}
            </span>
            <h3 className="font-heading text-h3 font-semibold text-ink-navy">
              {activeStep.title}
            </h3>
            <div className="flex items-center gap-1.5">
              {steps.map((s, i) => (
                <span
                  key={s.id}
                  aria-hidden
                  className={`h-1 rounded-full transition-all ${
                    i === activeStepIdx
                      ? "w-4 bg-draep-orange"
                      : i < activeStepIdx
                        ? "w-1 bg-ink-navy/60"
                        : "w-1 bg-ink-navy/20"
                  }`}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {phase === "loading-tree" ? (
        <div className="flex flex-col items-center gap-3 py-12">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-ink-navy border-t-transparent" />
          <p className="text-caption text-muted">Loading design options…</p>
        </div>
      ) : phase === "error" ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-body text-ink">{errorMsg ?? "Something went wrong."}</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void loadTree()}
              className="rounded-pill border border-hairline-strong bg-chalk-white px-4 py-2 text-caption font-semibold text-ink-navy"
            >
              Retry
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-pill bg-ink-navy px-4 py-2 text-caption font-semibold text-chalk-white"
            >
              Back
            </button>
          </div>
        </div>
      ) : activeStep ? (
        <div className="pb-8">
          <StepCards
            step={activeStep}
            selections={selections}
            disabled={saving}
            generating={false}
            onBack={
              activeStepIdx > 0
                ? () => setActiveStepIdx((i) => Math.max(0, i - 1))
                : undefined
            }
            onSelect={handleSelectOption}
          />
        </div>
      ) : (
        <div className="rounded-card border border-hairline bg-mist-navy/10 px-4 py-8 text-center text-caption text-muted">
          No design options configured for this garment.
        </div>
      )}

      {saveError && (
        <div
          role="alert"
          className="mb-4 rounded-card border border-error-border bg-error-bg px-4 py-3 text-caption text-error-text"
        >
          {saveError}
        </div>
      )}
    </BottomSheet>
  );
}
