/**
 * Brand icon set — Brand Book §6 (Iconography & Graphic Motifs).
 *
 * 2px rounded strokes, navy by default, orange for the active state.
 * No off-the-shelf icon library is used; this is the only set the app draws from.
 * Every icon inherits currentColor so callers control color via className.
 */

import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function svg(props: IconProps) {
  const { size = 20, ...rest } = props;
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    ...rest,
  };
}

export function ArrowLeft(props: IconProps) {
  return (
    <svg {...svg(props)}>
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

export function ArrowRight(props: IconProps) {
  return (
    <svg {...svg(props)}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function ChevronRight(props: IconProps) {
  return (
    <svg {...svg(props)}>
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}

export function ChevronDown(props: IconProps) {
  return (
    <svg {...svg(props)}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function Check(props: IconProps) {
  return (
    <svg {...svg(props)}>
      <path d="M5 12l5 5 9-10" />
    </svg>
  );
}

export function Flip(props: IconProps) {
  return (
    <svg {...svg(props)}>
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}

export function MapPin(props: IconProps) {
  return (
    <svg {...svg(props)}>
      <path d="M12 22s-7-7-7-12a7 7 0 0 1 14 0c0 5-7 12-7 12z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}

export function Crosshair(props: IconProps) {
  return (
    <svg {...svg(props)}>
      <circle cx="12" cy="12" r="7" />
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
    </svg>
  );
}

export function Close(props: IconProps) {
  return (
    <svg {...svg(props)}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function Plus(props: IconProps) {
  return (
    <svg {...svg(props)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function Minus(props: IconProps) {
  return (
    <svg {...svg(props)}>
      <path d="M5 12h14" />
    </svg>
  );
}

export function Trash(props: IconProps) {
  return (
    <svg {...svg(props)}>
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

export function User(props: IconProps) {
  return (
    <svg {...svg(props)}>
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

export function Maximize2(props: IconProps) {
  return (
    <svg {...svg(props)}>
      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
    </svg>
  );
}

export function Minimize2(props: IconProps) {
  return (
    <svg {...svg(props)}>
      <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />
    </svg>
  );
}

export function Sparkle(props: IconProps) {
  return (
    <svg {...svg(props)}>
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
      <circle cx="12" cy="12" r="3.5" />
    </svg>
  );
}

/**
 * Sparkles — the classic "AI" glyph: a large 4-point star plus two smaller
 * companions. Used wherever we reference AI-powered features (try-on, etc).
 */
export function Sparkles(props: IconProps) {
  const { size = 20, ...rest } = props;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...rest}
    >
      {/* Big 4-point star */}
      <path
        d="M12 3l1.6 4.4a4 4 0 0 0 2.3 2.3L20.5 12l-4.6 2.3a4 4 0 0 0-2.3 2.3L12 21l-1.6-4.4a4 4 0 0 0-2.3-2.3L3.5 12l4.6-2.3a4 4 0 0 0 2.3-2.3L12 3z"
        fill="currentColor"
        stroke="none"
      />
      {/* Small spark, top-right */}
      <path d="M19 3.5l.5 1.4 1.4.5-1.4.5-.5 1.4-.5-1.4L17 5.4l1.4-.5.5-1.4z" fill="currentColor" stroke="none" />
      {/* Small spark, bottom-left */}
      <path d="M4.5 17l.4 1.1 1.1.4-1.1.4-.4 1.1-.4-1.1L3 18.5l1.1-.4.4-1.1z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function Calendar(props: IconProps) {
  return (
    <svg {...svg(props)}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 9h18M8 3v4M16 3v4" />
    </svg>
  );
}

export function Clock(props: IconProps) {
  return (
    <svg {...svg(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

export function HomeVisit(props: IconProps) {
  return (
    <svg {...svg(props)}>
      <path d="M3 12l9-8 9 8" />
      <path d="M5 10v9h14v-9" />
      <path d="M9 19v-5h6v5" />
    </svg>
  );
}

export function Ruler(props: IconProps) {
  return (
    <svg {...svg(props)}>
      <path d="M3 16L16 3l5 5L8 21z" />
      <path d="M7 13l2 2M10 10l2 2M13 7l2 2" />
    </svg>
  );
}

export function ShieldCheck(props: IconProps) {
  return (
    <svg {...svg(props)}>
      <path d="M12 3l8 3v5c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

export function Scissors(props: IconProps) {
  return (
    <svg {...svg(props)}>
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M8.5 8.5L20 18M8.5 15.5L20 6" />
    </svg>
  );
}

export function Thread(props: IconProps) {
  return (
    <svg {...svg(props)}>
      <path d="M4 20a8 8 0 0 1 8-8 8 8 0 0 0 8-8" />
      <path d="M20 4a3 3 0 0 0-3 3" />
      <circle cx="4" cy="20" r="1.5" />
    </svg>
  );
}

export function BodyFront(props: IconProps) {
  return (
    <svg {...svg(props)}>
      <circle cx="12" cy="5" r="2.5" />
      <path d="M12 8v9M9 8h6M9 8l-2 9M15 8l2 9M10 17l-1 4M14 17l1 4" />
    </svg>
  );
}

export function Neck(props: IconProps) {
  return (
    <svg {...svg(props)}>
      <path d="M8 3h8v4a4 4 0 0 1-8 0V3z" />
      <path d="M10 13v8M14 13v8M10 17h4" />
    </svg>
  );
}

export function Upload(props: IconProps) {
  return (
    <svg {...svg(props)}>
      <path d="M12 16V4" />
      <path d="M7 9l5-5 5 5" />
      <path d="M5 16v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

export function Pencil(props: IconProps) {
  return (
    <svg {...svg(props)}>
      <path d="M14 4l6 6L8 22H2v-6L14 4z" />
      <path d="M11 7l6 6" />
    </svg>
  );
}

export function Eye(props: IconProps) {
  return (
    <svg {...svg(props)}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function EyeOff(props: IconProps) {
  return (
    <svg {...svg(props)}>
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 19c-6.5 0-10-7-10-7a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19" />
      <path d="M9.5 9.5a3 3 0 0 0 4.24 4.24" />
      <path d="M6 6l12 12" />
    </svg>
  );
}

export function ChatBubble(props: IconProps) {
  return (
    <svg {...svg(props)}>
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
    </svg>
  );
}
