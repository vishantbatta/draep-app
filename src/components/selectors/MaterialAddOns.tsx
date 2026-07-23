"use client";

/**
 * MaterialAddOns — shared list of material add-on rows (spec §6.7).
 *
 * Used by:
 *   - /design/add-ons page (wrapped in DesignScreenShell)
 *   - ReviewEditSheet (inside a BottomSheet)
 *
 * One source of truth for the AddOnRow wiring — no duplication.
 */

import { AddOnRow } from "@/components/selectors/AddOnRow";
import { useBookingStore } from "@/lib/booking-store";
import { ADD_ONS } from "@/lib/catalog";
import { strings } from "@/lib/strings";

interface MaterialAddOnsProps {
  /** Route to pass to each AddOnRow for placement filtering. */
  route?: string | null;
  /** Analytics source label. */
  source?: "context" | "addons_screen" | "review_sheet";
}

export function MaterialAddOns({
  route = null,
  source = "addons_screen",
}: MaterialAddOnsProps) {
  const draft = useBookingStore((s) => s.draft);
  const setAddOn = useBookingStore((s) => s.setAddOn);
  const updateAddOn = useBookingStore((s) => s.updateAddOn);
  const removeAddOn = useBookingStore((s) => s.removeAddOn);

  if (!draft) return null;

  const materialAddOns = ADD_ONS.filter((a) => a.group === "addon_material");
  const sleeveOptionId = draft.selections["sleeve"]?.optionId;

  return (
    <div className="space-y-2">
      {materialAddOns.map((addOn) => {
        const state = draft.addOns[addOn.id];
        return (
          <AddOnRow
            key={addOn.id}
            addOn={addOn}
            state={state}
            route={route}
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
      })}
    </div>
  );
}
