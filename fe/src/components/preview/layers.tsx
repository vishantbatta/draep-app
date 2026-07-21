/**
 * BlousePreview layers — simplified brand-styled SVG per option/sub-option.
 *
 * V0 placeholders per plan's scope decision. Style follows Brand Book §6:
 * 2px rounded navy strokes, orange for the active layer.
 *
 * Real design illustrations slot in unchanged — each function returns an SVG
 * fragment sharing the 240×280 viewBox.
 */

import type { ReactNode } from "react";

const VB_W = 240;
const VB_H = 280;

/**
 * Base blouse silhouette. Front and back share the same outline;
 * the preview component picks which face to render based on the layer's `view`.
 */
export function BaseBlouseFront(): ReactNode {
  return (
    <g
      stroke="var(--ink-navy)"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="var(--chalk-white)"
    >
      {/* Shoulder line */}
      <path d="M55 78 Q120 60, 185 78" fill="none" />
      {/* Body outline — armscye to hem */}
      <path d="M55 78 L40 100 Q40 130, 50 150 L55 230 Q55 245, 70 248 L170 248 Q185 245, 185 230 L190 150 Q200 130, 200 100 L185 78" fill="var(--chalk-white)" />
      {/* Armholes (subtle curves) */}
      <path d="M55 80 Q48 100, 50 120" fill="none" />
      <path d="M185 80 Q192 100, 190 120" fill="none" />
    </g>
  );
}

export function BaseBlouseBack(): ReactNode {
  // Back view: similar silhouette, smooth nape line instead of neckline detail
  return (
    <g
      stroke="var(--ink-navy)"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="var(--chalk-white)"
    >
      <path d="M55 78 Q120 64, 185 78" fill="none" />
      <path d="M55 78 L40 100 Q40 130, 50 150 L55 230 Q55 245, 70 248 L170 248 Q185 245, 185 230 L190 150 Q200 130, 200 100 L185 78" fill="var(--chalk-white)" />
      {/* Center-back seam hint */}
      <path d="M120 70 L120 248" fill="none" stroke="var(--tape-silver)" />
    </g>
  );
}

/**
 * Layer registry — maps a layer id (from layerManifest) to an SVG fragment.
 * Falls back to a small mark if a layer is not yet illustrated.
 */
const LAYER_RENDERERS: Record<string, () => ReactNode> = {
  /* ---------------- Cut ---------------- */
  "blouse_cut:princess": () => (
    <g stroke="var(--ink-navy)" strokeWidth="1.8" fill="none">
      <path d="M75 78 Q78 150, 90 248" />
      <path d="M165 78 Q162 150, 150 248" />
    </g>
  ),
  "blouse_cut:katori": () => (
    <g stroke="var(--ink-navy)" strokeWidth="1.8" fill="none">
      <path d="M85 95 Q120 130, 155 95" />
      <path d="M85 95 L85 200" />
      <path d="M155 95 L155 200" />
    </g>
  ),

  /* ---------------- Length ---------------- */
  "blouse_length:short_choli": () => (
    <g stroke="var(--ink-navy)" strokeWidth="1.8" fill="none">
      <path d="M55 175 L70 180 L170 180 L185 175" />
    </g>
  ),
  "blouse_length:long_waist": () => (
    <g stroke="var(--ink-navy)" strokeWidth="1.8" fill="none">
      <path d="M50 290 L55 270 L185 270 L190 290" />
    </g>
  ),

  /* ---------------- Front neck ---------------- */
  "front_neck:round": () => (
    <path d="M95 78 Q120 105, 145 78" stroke="var(--ink-navy)" strokeWidth="2" fill="none" />
  ),
  "front_neck:deep": () => (
    <path d="M95 78 Q120 135, 145 78" stroke="var(--ink-navy)" strokeWidth="2" fill="none" />
  ),
  "front_neck:sweetheart": () => (
    <path d="M95 78 Q107 100, 120 90 Q133 100, 145 78" stroke="var(--ink-navy)" strokeWidth="2" fill="none" />
  ),
  "front_neck:boat": () => (
    <path d="M70 88 Q120 100, 170 88" stroke="var(--ink-navy)" strokeWidth="2" fill="none" />
  ),
  "front_neck:high_neck": () => (
    <path d="M95 70 L145 70" stroke="var(--ink-navy)" strokeWidth="2" fill="none" />
  ),

  /* ---------------- Back cut ---------------- */
  "back_cut:regular": () => (
    <path d="M95 78 Q120 95, 145 78" stroke="var(--ink-navy)" strokeWidth="2" fill="none" />
  ),
  "back_cut:deep": () => (
    <path d="M95 78 Q120 125, 145 78" stroke="var(--ink-navy)" strokeWidth="2" fill="none" />
  ),
  "back_cut:backless": () => (
    <path d="M95 78 Q120 180, 145 78" stroke="var(--ink-navy)" strokeWidth="2" fill="none" />
  ),

  /* ---------------- Tying (back view) ---------------- */
  "tying:hook:back": () => (
    <g stroke="var(--ink-navy)" strokeWidth="1.8" fill="none">
      <circle cx="120" cy="100" r="3" fill="var(--ink-navy)" />
      <path d="M115 100 L110 110" />
    </g>
  ),
  "tying:chain:back": () => (
    <g stroke="var(--ink-navy)" strokeWidth="1.4" fill="none">
      <circle cx="120" cy="95" r="2" />
      <circle cx="120" cy="105" r="2" />
      <circle cx="120" cy="115" r="2" />
      <circle cx="120" cy="125" r="2" />
    </g>
  ),
  "tying:button:back": () => (
    <g stroke="var(--ink-navy)" strokeWidth="1.4" fill="none">
      <circle cx="120" cy="100" r="3" fill="var(--tape-silver)" />
      <circle cx="120" cy="115" r="3" fill="var(--tape-silver)" />
      <circle cx="120" cy="130" r="3" fill="var(--tape-silver)" />
    </g>
  ),

  /* ---------------- Shoulder ---------------- */
  "shoulder:off_shoulder": () => (
    <path d="M40 95 Q120 110, 200 95" stroke="var(--ink-navy)" strokeWidth="2" fill="none" />
  ),
  "shoulder:one_shoulder": () => (
    <path d="M55 78 L75 60" stroke="var(--ink-navy)" strokeWidth="3" fill="none" />
  ),
  "shoulder:strappy": () => (
    <g stroke="var(--ink-navy)" strokeWidth="1.5" fill="none">
      <path d="M55 78 L75 65" />
      <path d="M185 78 L165 65" />
    </g>
  ),
  "shoulder:halter": () => (
    <g stroke="var(--ink-navy)" strokeWidth="1.5" fill="none">
      <path d="M85 78 L120 50" />
      <path d="M155 78 L120 50" />
    </g>
  ),
  "shoulder:cold_shoulder": () => (
    <g stroke="var(--ink-navy)" strokeWidth="1.5" fill="none">
      <path d="M55 100 L75 100" />
      <path d="M185 100 L165 100" />
    </g>
  ),

  /* ---------------- Sleeve ---------------- */
  "sleeve:cap": () => (
    <g stroke="var(--ink-navy)" strokeWidth="1.8" fill="none">
      <path d="M40 100 Q25 110, 30 120" />
      <path d="M200 100 Q215 110, 210 120" />
    </g>
  ),
  "sleeve:regular_short": () => (
    <g stroke="var(--ink-navy)" strokeWidth="1.8" fill="none">
      <path d="M40 100 L22 140" />
      <path d="M200 100 L218 140" />
    </g>
  ),
  "sleeve:elbow": () => (
    <g stroke="var(--ink-navy)" strokeWidth="1.8" fill="none">
      <path d="M40 100 L18 165" />
      <path d="M200 100 L222 165" />
    </g>
  ),
  "sleeve:three_quarter": () => (
    <g stroke="var(--ink-navy)" strokeWidth="1.8" fill="none">
      <path d="M40 100 L15 195" />
      <path d="M200 100 L225 195" />
    </g>
  ),
  "sleeve:full": () => (
    <g stroke="var(--ink-navy)" strokeWidth="1.8" fill="none">
      <path d="M40 100 L10 225" />
      <path d="M200 100 L230 225" />
    </g>
  ),

  /* ---------------- Add-ons ---------------- */
  "addon:keyhole_front": () => (
    <ellipse cx="120" cy="95" rx="8" ry="12" stroke="var(--ink-navy)" strokeWidth="1.6" fill="none" />
  ),
  "addon:keyhole_back": () => (
    <ellipse cx="120" cy="95" rx="8" ry="12" stroke="var(--ink-navy)" strokeWidth="1.6" fill="none" />
  ),
  "addon:piping": () => (
    <g stroke="var(--draep-orange)" strokeWidth="1.4" fill="none">
      <path d="M55 78 Q120 64, 185 78" />
      <path d="M95 78 Q120 105, 145 78" />
      <path d="M55 230 L185 230" />
    </g>
  ),
  "addon:border": () => (
    <g stroke="var(--draep-orange)" strokeWidth="2" fill="none">
      <path d="M55 235 L185 235" />
      <path d="M55 240 L185 240" />
    </g>
  ),
  "addon:latkan:front_neck": () => (
    <circle cx="120" cy="110" r="6" fill="var(--draep-orange)" />
  ),
  "addon:latkan:back_neck": () => (
    <circle cx="120" cy="100" r="6" fill="var(--draep-orange)" />
  ),
  "addon:latkan:sleeves": () => (
    <g fill="var(--draep-orange)">
      <circle cx="25" cy="135" r="4" />
      <circle cx="215" cy="135" r="4" />
    </g>
  ),
  "addon:latkan:bottom": () => (
    <g fill="var(--draep-orange)">
      <circle cx="80" cy="245" r="4" />
      <circle cx="160" cy="245" r="4" />
    </g>
  ),
  "addon:tassels:front_neck": () => (
    <g stroke="var(--draep-orange)" strokeWidth="1.2" fill="none">
      <path d="M120 105 L120 130" />
      <path d="M115 125 L120 135 L125 125" />
    </g>
  ),
  "addon:tassels:back_neck": () => (
    <g stroke="var(--draep-orange)" strokeWidth="1.2" fill="none">
      <path d="M120 95 L120 120" />
      <path d="M115 115 L120 125 L125 115" />
    </g>
  ),
  "addon:tassels:sleeves": () => (
    <g stroke="var(--draep-orange)" strokeWidth="1.2" fill="none">
      <path d="M22 140 L22 160" />
      <path d="M218 140 L218 160" />
    </g>
  ),
  "addon:tassels:bottom": () => (
    <g stroke="var(--draep-orange)" strokeWidth="1.2" fill="none">
      <path d="M70 248 L70 268" />
      <path d="M120 248 L120 268" />
      <path d="M170 248 L170 268" />
    </g>
  ),
  "addon:net_work:front_neck": () => (
    <g stroke="var(--ink-navy)" strokeWidth="0.8" fill="none" opacity="0.6">
      <path d="M100 80 L140 80 M100 90 L140 90 M100 100 L140 100" />
      <path d="M100 80 L100 100 M120 80 L120 100 M140 80 L140 100" />
    </g>
  ),
  "addon:net_work:back_neck": () => (
    <g stroke="var(--ink-navy)" strokeWidth="0.8" fill="none" opacity="0.6">
      <path d="M100 80 L140 80 M100 90 L140 90 M100 100 L140 100" />
      <path d="M100 80 L100 100 M120 80 L120 100 M140 80 L140 100" />
    </g>
  ),
  "addon:net_work:sleeves": () => null,
  "addon:net_work:bottom": () => null,
};

/** Render an SVG fragment for a given layer id. */
export function renderLayer(id: string): ReactNode {
  const fn = LAYER_RENDERERS[id];
  return fn ? fn() : null;
}

export const PREVIEW_VIEWBOX = { width: VB_W, height: VB_H } as const;
