"use client";

/**
 * ReviewEditSheet — bottom-sheet editor for the review screen.
 *
 * Instead of navigating back to a design step (and tapping Next, Next, Next…),
 * the user opens this sheet, changes their selection, and taps Done.
 *
 * Uses the exact same selector components as the design pages:
 *   - OptionCardGrid   (structure steps: cut, length, front-neck, back, tying)
 *   - ContextualAddOns (style add-ons for the active category)
 *   - ChipGroup + SubOptionChips  (fit screen: shoulder, sleeve, neck_side)
 *   - MaterialAddOns   (all material add-ons)
 *   - SingleAddOn      (one specific add-on in isolation)
 */

import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { OptionCardGrid } from "@/components/selectors/OptionCardGrid";
import { ChipGroup } from "@/components/selectors/ChipGroup";
import { SubOptionChips } from "@/components/selectors/SubOptionChips";
import { ContextualAddOns } from "@/components/selectors/ContextualAddOns";
import { MaterialAddOns } from "@/components/selectors/MaterialAddOns";
import { SingleAddOn } from "@/components/selectors/SingleAddOn";

import { CATEGORY_BY_ID, ADDON_BY_ID } from "@/lib/catalog";
import { useBookingStore } from "@/lib/booking-store";
import { optionPriceLabel } from "@/lib/use-category";
import { strings } from "@/lib/strings";
import { track } from "@/lib/analytics";
import type { Category } from "@/types/booking";

const SHOULDER: Category = CATEGORY_BY_ID["shoulder"];
const SLEEVE: Category = CATEGORY_BY_ID["sleeve"];
const NECK_SIDE: Category = CATEGORY_BY_ID["neck_side"];

/* ============================================================ */

interface ReviewEditSheetProps {
  /** The testId of the row being edited, or null when closed. */
  editingId: string | null;
  onClose: () => void;
}

export function ReviewEditSheet({ editingId, onClose }: ReviewEditSheetProps) {
  const meta = editingId ? resolveEditTarget(editingId) : null;

  return (
    <BottomSheet
      open={Boolean(meta)}
      onClose={onClose}
      title={meta?.title ?? ""}
      footer={
        meta ? (
          <Button fullWidth onClick={onClose}>
            {strings.review.done}
          </Button>
        ) : null
      }
    >
      {meta && <EditContent meta={meta} />}
    </BottomSheet>
  );
}

/* ============================================================
 * EditContent — renders the right selectors based on the target
 * ============================================================ */

function EditContent({ meta }: { meta: EditTarget }) {
  if (meta.kind === "category") {
    return <CategoryEditor categoryId={meta.categoryId} route={meta.route} />;
  }

  if (meta.kind === "fit") {
    return <FitEditor />;
  }

  if (meta.kind === "material_addons") {
    return <MaterialAddOns source="review_sheet" />;
  }

  if (meta.kind === "addon") {
    return <SingleAddOn addOnId={meta.addOnId} source="review_sheet" />;
  }

  return null;
}

/* ============================================================
 * CategoryEditor — OptionCardGrid + ContextualAddOns (same as
 * design pages like cut, length, front-neck, back, tying)
 * ============================================================ */

function CategoryEditor({ categoryId, route }: { categoryId: string; route: string }) {
  const category = CATEGORY_BY_ID[categoryId];
  const draft = useBookingStore((s) => s.draft);
  const setSelectionInStore = useBookingStore((s) => s.setSelection);

  if (!draft || !category) return null;

  const selection = draft.selections[categoryId] ?? null;

  const setSelection = (next: { optionId: string; subOptionId?: string }) => {
    const previousOptionId = selection?.optionId ?? null;
    setSelectionInStore(categoryId, next);
    track({
      event: "option_changed",
      categoryId,
      from: previousOptionId,
      to: next.optionId,
      subOptionId: next.subOptionId,
    });
  };

  return (
    <div>
      <OptionCardGrid
        category={category}
        selection={selection}
        onSelect={setSelection}
      />
      <ContextualAddOns route={route} />
    </div>
  );
}

/* ============================================================
 * FitEditor — shoulder, sleeve, neck_side (same ChipGroup layout
 * as /design/fit, minus ContextualAddOns which is handled separately)
 * ============================================================ */

function FitEditor() {
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
    <div className="space-y-5">
      {/* Shoulder */}
      <div>
        <h3 className="mb-2 font-heading text-h3 text-ink-navy">
          {strings.fitScreen.shoulderHeading}
        </h3>
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
            <div className="mt-2">
              <SubOptionChips
                show
                subOptions={option.subOptions}
                selectedId={shoulderSel.subOptionId}
                onSelect={(subId) => handleSelect(SHOULDER.id, option.id, subId)}
                glyphKey={option.id}
              />
            </div>
          );
        })()}
      </div>

      <div className="tick-divider" aria-hidden />

      {/* Sleeve */}
      <div>
        <h3 className="mb-2 font-heading text-h3 text-ink-navy">
          {strings.fitScreen.sleeveHeading}
        </h3>
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
      </div>

      <div className="tick-divider" aria-hidden />

      {/* Neck side */}
      <div>
        <h3 className="mb-2 font-heading text-h3 text-ink-navy">
          {strings.fitScreen.neckSideHeading}
        </h3>
        <ChipGroup
          glyphKey="neck_side"
          options={NECK_SIDE.options}
          selectedId={draft.selections[NECK_SIDE.id]?.optionId}
          onSelect={(optionId) => handleSelect(NECK_SIDE.id, optionId)}
        />
      </div>

      <ContextualAddOns route="/design/fit" />
    </div>
  );
}

/* ============================================================
 * resolveEditTarget — maps a testId to the right editor type
 * ============================================================ */

type EditTarget =
  | { kind: "category"; categoryId: string; route: string; title: string }
  | { kind: "fit"; title: string }
  | { kind: "material_addons"; title: string }
  | { kind: "addon"; addOnId: string; title: string };

function resolveEditTarget(id: string): EditTarget | null {
  // Special sentinel for the "manage all material add-ons" button.
  if (id === "__material_addons__") {
    return { kind: "material_addons", title: "Material add-ons" };
  }

  // Fit categories all share /design/fit — group them.
  if (id === "shoulder" || id === "sleeve" || id === "neck_side") {
    return { kind: "fit", title: "Fit & structure" };
  }

  // Check if it's a catalog category (structure steps).
  const category = CATEGORY_BY_ID[id];
  if (category) {
    return {
      kind: "category",
      categoryId: id,
      route: category.route,
      title: category.label,
    };
  }

  // Check if it's an add-on.
  const addOn = ADDON_BY_ID[id];
  if (addOn) {
    return { kind: "addon", addOnId: id, title: addOn.label };
  }

  return null;
}
