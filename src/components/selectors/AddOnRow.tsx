"use client";

/**
 * AddOnRow — Brand Book §5.4 + spec §5.4, §6.7.
 *
 * Variants by kind:
 *   toggle     : Yes/No switch
 *   choice     : reveals a chip set when enabled (e.g. lining full/half)
 *   placements : multi-select placements; placement-scoped rendering for
 *                contextual rows (spec §7 note — visiblePlacementsFor).
 *
 * Default state: off / none selected.
 * While expanded and the user is choosing, the add-on is ghost-rendered on
 * BlousePreview at 50% opacity; on confirm it renders solid.
 *
 * Two-way bound rows (Button decor on /design/tying and /design/add-ons) share
 * Zustand state — caption surfaces the duplication per spec §6.5.
 */

import { AnimatePresence, motion } from "framer-motion";
import { useMemo } from "react";

import { clsx } from "clsx";

import { Chip } from "@/components/ui/Chip";
import { ChevronDown, Check, Plus } from "@/components/ui/icons";
import { PlacementSizePicker } from "@/components/selectors/PlacementSizePicker";
import { MonoNumber } from "@/components/ui/MonoNumber";
import { visiblePlacementsFor } from "@/lib/catalog";
import { formatPrice } from "@/lib/pricing";
import { strings } from "@/lib/strings";
import { track } from "@/lib/analytics";
import type { AddOn, AddOnState } from "@/types/booking";

interface AddOnRowProps {
  addOn: AddOn;
  state: AddOnState | undefined;
  route: string | null;
  source: "context" | "addons_screen" | "review_sheet";
  onToggle: (enabled: boolean) => void;
  onChoose: (choiceId: string) => void;
  onTogglePlacement: (placementId: string, on: boolean) => void;
  onChoosePlacementSize: (placementId: string, sizeId: string) => void;
  onSetExtraInput?: (key: string, value: string) => void;
  onPreviewStart?: (layerId: string) => void;
  onPreviewEnd?: () => void;
}

export function AddOnRow({
  addOn,
  state,
  route,
  source,
  onToggle,
  onChoose,
  onTogglePlacement,
  onChoosePlacementSize,
  onSetExtraInput,
  onPreviewStart,
  onPreviewEnd,
}: AddOnRowProps) {
  const enabled = state?.enabled ?? false;
  const priceLabel = addOn.priceKey ? `+ ${formatPrice(priceFor(addOn))}` : undefined;
  const placements = useMemo(
    () => visiblePlacementsFor(addOn.id, route),
    [addOn.id, route],
  );

  const ghostLayerId = enabled
    ? null
    : addOn.kind === "placements"
      ? placements?.[0]?.id
        ? `addon:${addOn.id}:${placements[0].id}`
        : null
      : `addon:${addOn.id}`;

  return (
    <div
      className={clsx(
        "rounded-card border bg-chalk-white transition-colors",
        enabled ? "border-draep-orange/50 bg-orange-fill/30" : "border-tape-silver",
      )}
      onPointerEnter={() => ghostLayerId && onPreviewStart?.(ghostLayerId)}
      onPointerLeave={() => onPreviewEnd?.()}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="flex h-10 w-10 flex-none items-center justify-center rounded-pill bg-warm-bg text-ink-navy">
          <Plus size={18} />
        </span>
        <div className="flex-1">
          <p className="font-heading text-h3 text-ink-navy">{addOn.label}</p>
          {addOn.caption && (
            <p className="text-caption text-ink-navy/70">{addOn.caption}</p>
          )}
        </div>
        {priceLabel && (
          <MonoNumber className="text-data text-ink-navy/80">{priceLabel}</MonoNumber>
        )}
        <ToggleSwitch
          checked={enabled}
          onChange={(v) => {
            onToggle(v);
            track({ event: "addon_toggled", addOnId: addOn.id, enabled: v, source });
          }}
          ariaLabel={`${addOn.label} ${enabled ? "on" : "off"}`}
        />
      </div>

      <AnimatePresence initial={false}>
        {enabled && addOn.kind === "choice" && addOn.choices && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden px-4 pb-3"
          >
            <div className="flex flex-wrap gap-2">
              {addOn.choices.map((choice) => (
                <Chip
                  key={choice.id}
                  selected={state?.choiceId === choice.id}
                  onClick={() => onChoose(choice.id)}
                >
                  {choice.label}
                </Chip>
              ))}
            </div>
          </motion.div>
        )}

        {enabled && addOn.kind === "placements" && placements && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden px-4 pb-3"
          >
            <p className="text-caption text-ink-navy/70 mb-1">Choose placements</p>
            <div className="flex flex-wrap gap-2">
              {placements.map((placement) => {
                const on = Boolean(state?.placements?.[placement.id]);
                return (
                  <Chip
                    key={placement.id}
                    selected={on}
                    onClick={() => onTogglePlacement(placement.id, !on)}
                    ariaPressed={on}
                  >
                    {on && <Check size={14} strokeWidth={2.5} />}
                    {placement.label}
                  </Chip>
                );
              })}
            </div>

            {/* Size picker per selected placement (latkan) */}
            {addOn.perPlacementSizes &&
              placements
                .filter((p) => state?.placements?.[p.id])
                .map((placement) => (
                  <PlacementSizePicker
                    key={placement.id}
                    placementLabel={placement.label}
                    sizes={addOn.perPlacementSizes!}
                    selectedSizeId={state?.placements?.[placement.id]?.sizeId}
                    onSelectSize={(sizeId) =>
                      onChoosePlacementSize(placement.id, sizeId)
                    }
                  />
                ))}
          </motion.div>
        )}

        {enabled && addOn.extraInput && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden px-4 pb-3"
          >
            <label className="block">
              <span className="text-caption text-ink-navy/70">
                {addOn.extraInput.label}
              </span>
              <input
                type={addOn.extraInput.type}
                value={state?.extraInputs?.[addOn.extraInput.id] ?? ""}
                onChange={(e) => onSetExtraInput?.(addOn.extraInput!.id, e.target.value)}
                className="mt-1 w-full rounded-card border border-tape-silver px-3 py-2 text-body focus-visible:outline-none focus-visible:border-navy-interactive"
              />
            </label>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function priceFor(addOn: AddOn): number {
  // Cheap lookup — duplicated from pricing-config to avoid a cycle.
  const prices: Record<string, number> = {
    piping: 80,
    lining: 120,
    button_decor: 60,
    boning: 100,
    border: 120,
    latkan: 90,
    breast_cups: 80,
    moti_work: 200,
    net_work: 150,
    keyhole: 60,
    tassels: 70,
  };
  return addOn.priceKey ? prices[addOn.priceKey] ?? 0 : 0;
}

/* ---- Toggle switch (iOS-style pill, brand-tinted) ---- */

function ToggleSwitch({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className={clsx(
        "relative inline-flex h-7 w-12 flex-none items-center rounded-pill transition-colors duration-200",
        checked ? "bg-draep-orange" : "bg-tape-silver",
      )}
    >
      <span
        className={clsx(
          "absolute h-5 w-5 transform rounded-full bg-chalk-white shadow-brand transition-transform duration-200 ease-brand",
          checked ? "translate-x-6" : "translate-x-1",
        )}
      />
    </button>
  );
}
