"use client";

/**
 * Material add-ons — spec §6.7.
 *
 * Single screen of AddOnRows on warm-bg section cards. Default = none selected.
 * Style add-ons (keyhole, tassels) already surfaced contextually — NOT repeated
 * here, but remain editable from Review.
 */

import { DesignScreenShell } from "@/components/layout/DesignScreenShell";
import { AddOnRow } from "@/components/selectors/AddOnRow";
import { useBookingStore } from "@/lib/booking-store";
import { ADD_ONS } from "@/lib/catalog";
import { strings } from "@/lib/strings";

const ROUTE = "/design/add-ons";

export default function AddOnsPage() {
  const draft = useBookingStore((s) => s.draft);
  const setAddOn = useBookingStore((s) => s.setAddOn);
  const updateAddOn = useBookingStore((s) => s.updateAddOn);
  const removeAddOn = useBookingStore((s) => s.removeAddOn);

  if (!draft) return null;

  // Only material add-ons here — style add-ons (keyhole, tassels) live on
  // their contextual design screens (spec §6.7).
  const materialAddOns = ADD_ONS.filter((a) => a.group === "addon_material");

  return (
    <DesignScreenShell
      draft={draft}
      route={ROUTE}
      title="Material add-ons"
      activeLayerPrefix="addon:"
    >
      <p className="mt-2 text-body text-ink-navy/85">
        Pick what you like — every add-on shows on your blouse preview as you choose.
      </p>

      <section className="mt-4 rounded-card bg-warm-bg p-4">
        <h2 className="font-heading text-h3 text-ink-navy">
          {strings.addonSection.materialHeading}
        </h2>
        <div className="mt-3 space-y-2">
          {materialAddOns.map((addOn) => {
            const state = draft.addOns[addOn.id];
            return (
              <AddOnRow
                key={addOn.id}
                addOn={addOn}
                state={state}
                route={ROUTE}
                source="addons_screen"
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
      </section>
    </DesignScreenShell>
  );
}
