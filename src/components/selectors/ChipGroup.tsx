"use client";

/**
 * ChipGroup — used on /design/fit where chips render inline (not as cards).
 * Same VisualChip treatment (thumbnail + label).
 */

import type { SubOption } from "@/types/booking";
import { VisualChip } from "@/components/selectors/VisualChip";
import { SubOptionGlyph } from "@/components/selectors/glyphs";

interface ChipGroupProps {
  options: SubOption[];
  selectedId?: string;
  glyphKey?: string;
  priceLabelFor?: (id: string) => string | undefined;
  onSelect: (id: string) => void;
  onPreviewStart?: (id: string) => void;
  onPreviewEnd?: () => void;
}

export function ChipGroup({
  options,
  selectedId,
  glyphKey,
  priceLabelFor,
  onSelect,
  onPreviewStart,
  onPreviewEnd,
}: ChipGroupProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <VisualChip
          key={opt.id}
          label={opt.label}
          thumbnail={<SubOptionGlyph keyId={glyphKey} subId={opt.id} />}
          selected={selectedId === opt.id}
          priceLabel={priceLabelFor?.(opt.id)}
          onPress={() => onSelect(opt.id)}
          onPreviewStart={() => onPreviewStart?.(opt.id)}
          onPreviewEnd={onPreviewEnd}
        />
      ))}
    </div>
  );
}
