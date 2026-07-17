/**
 * Glyphs — small SVG thumbnails used by VisualChip / OptionCard / AddOnRow.
 *
 * Each glyph renders the option's *shape* (U-shape, V-shape, Round, Square, etc)
 * in 24×24 viewBox. Brand style: 2px rounded strokes, navy default, orange active
 * (caller controls color via currentColor).
 */

import type React from "react";

import { renderLayer } from "@/components/preview/layers";

interface GlyphProps {
  size?: number;
}

function svg(size = 24, viewBox = "0 0 24 24") {
  return {
    width: size,
    height: size,
    viewBox,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
}

/* ---- Front/back neck sub-shapes (U, V, Round, Square, etc.) ---- */

export function UShapeGlyph({ size }: GlyphProps) {
  return (
    <svg {...svg(size)}>
      <path d="M6 5 L6 16 Q6 19, 9 19 L15 19 Q18 19, 18 16 L18 5" />
    </svg>
  );
}

export function VShapeGlyph({ size }: GlyphProps) {
  return (
    <svg {...svg(size)}>
      <path d="M6 5 L12 19 L18 5" />
    </svg>
  );
}

export function RoundGlyph({ size }: GlyphProps) {
  return (
    <svg {...svg(size)}>
      <path d="M5 5 Q12 17, 19 5" />
    </svg>
  );
}

export function SquareGlyph({ size }: GlyphProps) {
  return (
    <svg {...svg(size)}>
      <path d="M6 5 L6 16 Q6 18, 8 18 L16 18 Q18 18, 18 16 L18 5" />
    </svg>
  );
}

export function TriangleGlyph({ size }: GlyphProps) {
  return (
    <svg {...svg(size)}>
      <path d="M5 5 L12 19 L19 5" />
    </svg>
  );
}

export function DropGlyph({ size }: GlyphProps) {
  return (
    <svg {...svg(size)}>
      <path d="M12 4 Q19 8, 19 13 Q19 18, 12 18 Q5 18, 5 13 Q5 8, 12 4 Z" />
    </svg>
  );
}

export function BowGlyph({ size }: GlyphProps) {
  return (
    <svg {...svg(size)}>
      <path d="M5 10 Q9 5, 12 10 Q15 5, 19 10 Q15 15, 12 10 Q9 15, 5 10 Z" />
    </svg>
  );
}

/* ---- Other shapes ---- */

export function StringsStraightGlyph({ size }: GlyphProps) {
  return (
    <svg {...svg(size)}>
      <path d="M7 4 L7 18 M12 4 L12 18 M17 4 L17 18" />
    </svg>
  );
}

export function StringsCrossGlyph({ size }: GlyphProps) {
  return (
    <svg {...svg(size)}>
      <path d="M6 4 L18 18 M18 4 L6 18" />
    </svg>
  );
}

export function StrapGlyph({ size }: GlyphProps) {
  return (
    <svg {...svg(size)}>
      <path d="M9 4 L9 18 M15 4 L15 18" />
    </svg>
  );
}

export function BandCollarGlyph({ size }: GlyphProps) {
  return (
    <svg {...svg(size)}>
      <rect x="4" y="6" width="16" height="5" rx="1.5" />
    </svg>
  );
}

export function FullCollarGlyph({ size }: GlyphProps) {
  return (
    <svg {...svg(size)}>
      <path d="M4 6 Q4 14, 12 18 Q20 14, 20 6" />
    </svg>
  );
}

export function FullHighGlyph({ size }: GlyphProps) {
  return (
    <svg {...svg(size)}>
      <rect x="4" y="4" width="16" height="14" rx="2" />
    </svg>
  );
}

export function FrontHookGlyph({ size }: GlyphProps) {
  return (
    <svg {...svg(size)}>
      <path d="M12 4 L12 18" />
      <circle cx="12" cy="9" r="1.6" fill="currentColor" />
    </svg>
  );
}

export function BackHookGlyph({ size }: GlyphProps) {
  return (
    <svg {...svg(size)}>
      <path d="M12 4 L12 18" />
      <circle cx="12" cy="13" r="1.6" fill="currentColor" />
    </svg>
  );
}

export function ChainGlyph({ size }: GlyphProps) {
  return (
    <svg {...svg(size)}>
      <circle cx="12" cy="6" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="12" cy="18" r="1.5" />
    </svg>
  );
}

export function ButtonGlyph({ size }: GlyphProps) {
  return (
    <svg {...svg(size)}>
      <circle cx="12" cy="8" r="1.6" fill="currentColor" />
      <circle cx="12" cy="14" r="1.6" fill="currentColor" />
      <circle cx="12" cy="20" r="1.6" fill="currentColor" />
    </svg>
  );
}

export function BroadGlyph({ size }: GlyphProps) {
  return (
    <svg {...svg(size)}>
      <path d="M6 4 L8 18 M18 4 L16 18" strokeWidth="3" />
    </svg>
  );
}

export function SpaghettiGlyph({ size }: GlyphProps) {
  return (
    <svg {...svg(size)}>
      <path d="M9 4 L9 18 M15 4 L15 18" />
    </svg>
  );
}

/* ---- Generic add-on glyphs ---- */

export function PlusGlyph({ size = 24 }: GlyphProps) {
  return (
    <svg {...svg(size)}>
      <path d="M12 4v16 M4 12h16" />
    </svg>
  );
}

export function CheckGlyph({ size = 24 }: GlyphProps) {
  return (
    <svg {...svg(size)}>
      <path d="M5 12l5 5 9-10" />
    </svg>
  );
}

/* ---- Option-card scale glyphs (larger illustrations) ---- */

export function OptionIllustration({ layerId }: { layerId: string }) {
  // Reuses blouse preview layers in a 96×96 framed box.
  return (
    <svg viewBox="0 0 240 280" className="h-24 w-auto">
      <g transform="translate(0,0)">{renderLayer(layerId)}</g>
    </svg>
  );
}

/* ---- SubOptionGlyph lookup ---- */

interface SubOptionGlyphProps {
  keyId?: string;
  subId: string;
}

const GLYPH_BY_KEY_SUBID: Record<string, Record<string, React.FC<GlyphProps>>> = {
  // Front/back neck sub-options
  deep: {
    u: UShapeGlyph,
    v: VShapeGlyph,
    round: RoundGlyph,
    square: SquareGlyph,
  },
  backless: {
    strings_straight: StringsStraightGlyph,
    strings_cross: StringsCrossGlyph,
    strap: StrapGlyph,
  },
  high_neck: {
    band_collar: BandCollarGlyph,
    full_collar: FullCollarGlyph,
    full_high: FullHighGlyph,
  },
  hook: { front: FrontHookGlyph, back: BackHookGlyph },
  chain: { left: ChainGlyph, right: ChainGlyph, back: ChainGlyph },
  button: { front: ButtonGlyph, back: ButtonGlyph },
  strappy: { broad: BroadGlyph, spaghetti: SpaghettiGlyph },
  halter: { broad: BroadGlyph, spaghetti: SpaghettiGlyph },
  // Keyhole shapes
  keyhole: {
    round: RoundGlyph,
    drop: DropGlyph,
    triangle: TriangleGlyph,
    bow: BowGlyph,
  },
};

export function SubOptionGlyph({ keyId, subId }: SubOptionGlyphProps) {
  const lookup = keyId ? GLYPH_BY_KEY_SUBID[keyId]?.[subId] : null;
  if (lookup) {
    const Cmp = lookup;
    return <Cmp />;
  }
  // Fallback: small filled dot
  return (
    <svg {...svg()}>
      <circle cx="12" cy="12" r="4" fill="currentColor" />
    </svg>
  );
}
