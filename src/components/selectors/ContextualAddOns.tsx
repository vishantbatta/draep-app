"use client";

/**
 * ContextualAddOns — "Style it up" card (spec §6.8).
 *
 * Renders below the option grid on 6.2–6.6. Each add-on is an AddOnRow
 * (off by default). Selecting reveals its sub-chips (e.g. keyhole shape).
 * Removing the parent selection clears its sub-choices.
 *
 * These write to the SAME `addOns` state as /design/add-ons — one source of
 * truth, surfaced in two places.
 */

import { AddOnRow } from "@/components/selectors/AddOnRow";
import { useBookingStore } from "@/lib/booking-store";
import { addOnsForRoute } from "@/lib/catalog";
import { strings } from "@/lib/strings";

interface ContextualAddOnsProps {
  route: string;
}

export function ContextualAddOns({ route }: ContextualAddOnsProps) {
  const draft = useBookingStore((s) => s.draft);
  const setAddOn = useBookingStore((s) => s.setAddOn);
  const updateAddOn = useBookingStore((s) => s.updateAddOn);
  const removeAddOn = useBookingStore((s) => s.removeAddOn);

  const addOns = addOnsForRoute(route);
  if (!addOns.length || !draft) return null;

  return (
    <section className="mt-6 rounded-card bg-warm-bg p-4">
      <h3 className="font-heading text-h3 text-ink-navy">
        {strings.addonSection.styleHeading}
      </h3>
      <p className="mt-1 text-caption text-ink-navy/70">
        {strings.addonSection.defaultCaption}
      </p>
      <div className="mt-3 space-y-2">
        {addOns.map((addOn) => {
          const state = draft.addOns[addOn.id];
          return (
            <AddOnRow
              key={addOn.id}
              addOn={addOn}
              state={state}
              route={route}
              source="context"
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
            />
          );
        })}
      </div>
    </section>
  );
}
