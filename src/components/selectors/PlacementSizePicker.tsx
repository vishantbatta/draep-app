"use client";

/**
 * PlacementSizePicker — for latkan (spec §6.7).
 *
 * Each selected placement reveals a size chip row: Small · Medium · Large.
 * Size is required per placement; default Medium.
 */

import type { SubOption } from "@/types/booking";
import { Chip } from "@/components/ui/Chip";

interface PlacementSizePickerProps {
  placementLabel: string;
  sizes: SubOption[];
  selectedSizeId?: string;
  onSelectSize: (sizeId: string) => void;
}

export function PlacementSizePicker({
  placementLabel,
  sizes,
  selectedSizeId,
  onSelectSize,
}: PlacementSizePickerProps) {
  return (
    <div className="ml-4 mt-2 border-l-2 border-tape-silver pl-3">
      <p className="text-caption text-ink-navy/70">{placementLabel} size</p>
      <div className="mt-1 flex flex-wrap gap-2">
        {sizes.map((size) => (
          <Chip
            key={size.id}
            selected={selectedSizeId === size.id}
            onClick={() => onSelectSize(size.id)}
          >
            {size.label}
          </Chip>
        ))}
      </div>
    </div>
  );
}
