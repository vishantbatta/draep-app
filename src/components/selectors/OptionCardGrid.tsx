"use client";

/**
 * OptionCardGrid — the standard 2-column grid for critical screens (spec §5.4).
 *
 * Wraps a list of options as OptionCards with radio semantics, ghost-preview
 * signaling, and the SubOptionChips slide-in when a sub-option-bearing parent
 * is selected.
 */

import { OptionCard } from "@/components/selectors/OptionCard";
import { SubOptionChips } from "@/components/selectors/SubOptionChips";
import { usePreviewSetter } from "@/components/layout/DesignScreenShell";
import { optionPriceLabel } from "@/lib/use-category";
import { selectionLayerId } from "@/components/preview/layerManifest";
import { OptionIllustration } from "@/components/selectors/glyphs";
import type { Category, Selection } from "@/types/booking";

interface OptionCardGridProps {
  category: Category;
  selection: Selection | null;
  onSelect: (next: Selection) => void;
}

export function OptionCardGrid({ category, selection, onSelect }: OptionCardGridProps) {
  const setPreview = usePreviewSetter();

  return (
    <div className="grid grid-cols-2 gap-3">
      {category.options.map((option) => {
        const isSelected = selection?.optionId === option.id;
        const hasSubOptions = Boolean(option.subOptions?.length);
        const showSubOptions = isSelected && hasSubOptions;

        // When a sub-option-bearing parent is selected without a subOptionId,
        // auto-select the first chip — zero-decision rule.
        if (
          isSelected &&
          hasSubOptions &&
          option.subOptions &&
          !selection?.subOptionId
        ) {
          onSelect({ optionId: option.id, subOptionId: option.subOptions[0].id });
        }

        const baseLayerId = selectionLayerId(category.id, option.id);

        return (
          <div key={option.id} className="col-span-1">
            <OptionCard
              label={option.label}
              illustration={<OptionIllustration layerId={baseLayerId} />}
              selected={isSelected}
              isDefault={category.defaultOptionId === option.id}
              priceLabel={optionPriceLabel(option.priceKey)}
              onSelect={() => {
                const next: Selection = hasSubOptions
                  ? {
                      optionId: option.id,
                      subOptionId: option.subOptions![0].id,
                    }
                  : { optionId: option.id };
                onSelect(next);
              }}
              onPreviewStart={() => setPreview(baseLayerId)}
              onPreviewEnd={() => setPreview(null)}
            />
            <SubOptionChips
              show={showSubOptions}
              subOptions={option.subOptions ?? []}
              selectedId={selection?.subOptionId}
              onSelect={(subId) =>
                onSelect({ optionId: option.id, subOptionId: subId })
              }
              onPreviewStart={(subId) =>
                setPreview(selectionLayerId(category.id, option.id, subId))
              }
              onPreviewEnd={() => setPreview(null)}
              glyphKey={option.id}
            />
          </div>
        );
      })}
    </div>
  );
}
