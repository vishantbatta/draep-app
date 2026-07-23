"use client";

/**
 * SingleAddOn — renders one AddOnRow with full store wiring.
 *
 * Used by the ReviewEditSheet when the user taps a specific style/material
 * add-on row (e.g. keyhole, tassels) to edit it in isolation.
 *
 * Same wiring logic as ContextualAddOns and the add-ons page.
 */

import { AddOnRow } from "@/components/selectors/AddOnRow";
import { useBookingStore } from "@/lib/booking-store";
import { ADDON_BY_ID } from "@/lib/catalog";

interface SingleAddOnProps {
  addOnId: string;
  /** Route for placement filtering. Falls back to the add-on's first contextRoute. */
  route?: string | null;
  source?: "context" | "addons_screen" | "review_sheet";
}

export function SingleAddOn({
  addOnId,
  route,
  source = "review_sheet",
}: SingleAddOnProps) {
  const addOn = ADDON_BY_ID[addOnId];
  const draft = useBookingStore((s) => s.draft);
  const setAddOn = useBookingStore((s) => s.setAddOn);
  const updateAddOn = useBookingStore((s) => s.updateAddOn);
  const removeAddOn = useBookingStore((s) => s.removeAddOn);

  if (!draft || !addOn) return null;

  const resolvedRoute = route ?? addOn.contextRoutes?.[0] ?? null;
  const state = draft.addOns[addOnId];
  const sleeveOptionId = draft.selections["sleeve"]?.optionId;

  return (
    <AddOnRow
      addOn={addOn}
      state={state}
      route={resolvedRoute}
      source={source}
      sleeveOptionId={sleeveOptionId}
      onToggle={(enabled) => {
        if (enabled) {
          setAddOn(addOn.id, {
            enabled: true,
            choiceId: addOn.choices?.[0]?.id,
          });
        } else {
          removeAddOn(addOn.id);
        }
      }}
      onChoose={(choiceId) => updateAddOn(addOn.id, { choiceId })}
      onTogglePlacement={(placementId, on) => {
        const current = state?.placements ?? {};
        if (on) {
          updateAddOn(addOn.id, {
            enabled: true,
            placements: {
              ...current,
              [placementId]: {
                sizeId: addOn.perPlacementSizes?.[1]?.id,
              },
            },
          });
        } else {
          const next = { ...current };
          delete next[placementId];
          updateAddOn(addOn.id, { placements: next });
        }
      }}
      onChoosePlacementSize={(placementId, sizeId) => {
        const current = state?.placements ?? {};
        updateAddOn(addOn.id, {
          placements: {
            ...current,
            [placementId]: { ...current[placementId], sizeId },
          },
        });
      }}
      onSetExtraInput={(key, value) => {
        const currentInputs = state?.extraInputs ?? {};
        updateAddOn(addOn.id, {
          extraInputs: { ...currentInputs, [key]: value },
        });
      }}
    />
  );
}
