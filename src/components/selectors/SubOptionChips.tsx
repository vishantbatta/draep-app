"use client";

/**
 * SubOptionChips — Brand Book §5.4 + spec §5.4.
 *
 * When a selected option has sub-options (e.g. Deep → U-shape), this row
 * slides in below the card (Tape Unroll, 400ms).
 *
 * A sub-option is required whenever its parent option is selected — auto-select
 * the first chip so the zero-decision rule holds; user can change it.
 */

import { AnimatePresence, motion } from "framer-motion";
import type { SubOption } from "@/types/booking";
import { VisualChip } from "@/components/selectors/VisualChip";
import { SubOptionGlyph } from "@/components/selectors/glyphs";

interface SubOptionChipsProps {
  show: boolean;
  subOptions: SubOption[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onPreviewStart?: (id: string) => void;
  onPreviewEnd?: () => void;
  glyphKey?: string; // parent layer prefix used to look up per-suboption glyphs
}

export function SubOptionChips({
  show,
  subOptions,
  selectedId,
  onSelect,
  onPreviewStart,
  onPreviewEnd,
  glyphKey,
}: SubOptionChipsProps) {
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          key="sub-options"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="overflow-hidden"
        >
          <div className="flex flex-wrap gap-2 py-2">
            {subOptions.map((opt) => (
              <VisualChip
                key={opt.id}
                label={opt.label}
                thumbnail={<SubOptionGlyph keyId={glyphKey} subId={opt.id} />}
                selected={selectedId === opt.id}
                onPress={() => onSelect(opt.id)}
                onPreviewStart={() => onPreviewStart?.(opt.id)}
                onPreviewEnd={onPreviewEnd}
              />
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
