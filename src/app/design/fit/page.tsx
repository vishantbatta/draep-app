"use client";

/**
 * Fit & structure — spec §6.6.
 *
 * Single screen with three sections:
 *   1. Shoulder (chips: Regular / Off-shoulder / One-shoulder / Strappy / Halter / Cold shoulder)
 *      - Strappy/Halter → sub-chips Broad / Thin-round (spaghetti)
 *   2. Sleeve style (chips, some priced: Regular short / Elbow / Three-quarter / Full)
 *      - Contextual add-on: Tassels — sleeves
 *   3. Neck (keyhole side) — chips: Front-side / Back-side
 *
 * Each category is prefilled (defaults pending product confirmation per §13).
 * H3 section headers with tick-mark dividers between groups.
 */

import { DesignScreenShell } from "@/components/layout/DesignScreenShell";
import { ChipGroup } from "@/components/selectors/ChipGroup";
import { SubOptionChips } from "@/components/selectors/SubOptionChips";
import { ContextualAddOns } from "@/components/selectors/ContextualAddOns";
import { usePreviewSetter } from "@/components/layout/DesignScreenShell";
import { CATEGORY_BY_ID } from "@/lib/catalog";
import { useBookingStore } from "@/lib/booking-store";
import { useCategory, optionPriceLabel } from "@/lib/use-category";
import { selectionLayerId } from "@/components/preview/layerManifest";
import { strings } from "@/lib/strings";
import { track } from "@/lib/analytics";
import type { Category } from "@/types/booking";

const ROUTE = "/design/fit";
const SHOULDER: Category = CATEGORY_BY_ID["shoulder"];
const SLEEVE: Category = CATEGORY_BY_ID["sleeve"];
const NECK_SIDE: Category = CATEGORY_BY_ID["neck_side"];

export default function FitPage() {
  const draft = useBookingStore((s) => s.draft);
  const setSelectionInStore = useBookingStore((s) => s.setSelection);

  if (!draft) return null;

  const handleSelect = (categoryId: string, optionId: string, subOptionId?: string) => {
    const previous = draft.selections[categoryId]?.optionId ?? null;
    setSelectionInStore(categoryId, { optionId, subOptionId });
    track({
      event: "option_changed",
      categoryId,
      from: previous,
      to: optionId,
      subOptionId,
    });
  };

  return (
    <DesignScreenShell
      draft={draft}
      route={ROUTE}
      title="Fit & structure"
      activeLayerPrefix={null}
    >
      {/* Shoulder */}
      <FitSection
        title={strings.fitScreen.shoulderHeading}
        categoryId={SHOULDER.id}
        defaultOptionId={SHOULDER.defaultOptionId}
      >
        <ChipGroup
          glyphKey="shoulder"
          options={SHOULDER.options}
          selectedId={draft.selections[SHOULDER.id]?.optionId}
          onSelect={(optionId) => {
            const option = SHOULDER.options.find((o) => o.id === optionId);
            handleSelect(SHOULDER.id, optionId, option?.subOptions?.[0]?.id);
          }}
        />
        {(() => {
          const shoulderSel = draft.selections[SHOULDER.id];
          if (!shoulderSel) return null;
          const option = SHOULDER.options.find((o) => o.id === shoulderSel.optionId);
          if (!option?.subOptions?.length) return null;
          return (
            <SubOptionChipsInline
              categoryId={SHOULDER.id}
              optionId={option.id}
              subOptions={option.subOptions}
              selectedId={shoulderSel.subOptionId}
              onSelect={(subId) => handleSelect(SHOULDER.id, option.id, subId)}
              glyphKey={option.id}
            />
          );
        })()}
      </FitSection>

      <TickMarkDivider />

      {/* Sleeve style */}
      <FitSection
        title={strings.fitScreen.sleeveHeading}
        categoryId={SLEEVE.id}
        defaultOptionId={SLEEVE.defaultOptionId}
      >
        <ChipGroup
          glyphKey="sleeve"
          options={SLEEVE.options}
          selectedId={draft.selections[SLEEVE.id]?.optionId}
          priceLabelFor={(id) => {
            const opt = SLEEVE.options.find((o) => o.id === id);
            return opt ? optionPriceLabel(opt.priceKey) : undefined;
          }}
          onSelect={(optionId) => handleSelect(SLEEVE.id, optionId)}
        />
      </FitSection>

      <TickMarkDivider />

      {/* Neck side */}
      <FitSection
        title={strings.fitScreen.neckSideHeading}
        categoryId={NECK_SIDE.id}
        defaultOptionId={NECK_SIDE.defaultOptionId}
      >
        <ChipGroup
          glyphKey="neck_side"
          options={NECK_SIDE.options}
          selectedId={draft.selections[NECK_SIDE.id]?.optionId}
          onSelect={(optionId) => handleSelect(NECK_SIDE.id, optionId)}
        />
      </FitSection>

      <ContextualAddOns route={ROUTE} />
    </DesignScreenShell>
  );
}

function FitSection({
  title,
  categoryId,
  defaultOptionId,
  children,
}: {
  title: string;
  categoryId: string;
  defaultOptionId: string | null;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-6">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="font-heading text-h2 text-ink-navy">{title}</h2>
        {defaultOptionId && (
          <span className="rounded-pill bg-orange-fill px-2 py-0.5 text-caption text-ink-navy">
            Default
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

function TickMarkDivider() {
  return (
    <div className="my-5 tick-divider" aria-hidden />
  );
}

function SubOptionChipsInline({
  categoryId,
  optionId,
  subOptions,
  selectedId,
  onSelect,
  glyphKey,
}: {
  categoryId: string;
  optionId: string;
  subOptions: { id: string; label: string }[];
  selectedId?: string;
  onSelect: (id: string) => void;
  glyphKey: string;
}) {
  const setPreview = usePreviewSetter();
  return (
    <div className="mt-3">
      <SubOptionChips
        show
        subOptions={subOptions}
        selectedId={selectedId}
        onSelect={onSelect}
        onPreviewStart={(subId) =>
          setPreview(selectionLayerId(categoryId, optionId, subId))
        }
        onPreviewEnd={() => setPreview(null)}
        glyphKey={glyphKey}
      />
    </div>
  );
}
