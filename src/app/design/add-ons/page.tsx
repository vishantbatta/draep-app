"use client";

/**
 * Material add-ons — spec §6.7.
 *
 * Single screen of AddOnRows on warm-bg section cards. Default = none selected.
 * Style add-ons (keyhole, tassels) already surfaced contextually — NOT repeated
 * here, but remain editable from Review.
 */

import { DesignScreenShell } from "@/components/layout/DesignScreenShell";
import { MaterialAddOns } from "@/components/selectors/MaterialAddOns";
import { useBookingStore } from "@/lib/booking-store";
import { strings } from "@/lib/strings";

const ROUTE = "/design/add-ons";

export default function AddOnsPage() {
  const draft = useBookingStore((s) => s.draft);

  if (!draft) return null;

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
        <div className="mt-3">
          <MaterialAddOns route={ROUTE} source="addons_screen" />
        </div>
      </section>
    </DesignScreenShell>
  );
}
