/**
 * Draep style catalog — verbatim port of Frontend Spec §7.
 *
 * Components MUST NOT hard-code options. Every selector reads from this file.
 * When defaults change, they change here — never inside a component.
 */

import type { AddOn, Category } from "@/types/booking";

export const CATALOG: Category[] = [
  {
    id: "blouse_cut",
    label: "Blouse cut",
    group: "critical",
    route: "/design/cut",
    defaultOptionId: "simple",
    options: [
      { id: "simple", label: "Simple cut" },
      { id: "princess", label: "Princess cut" },
      { id: "katori", label: "Katori cut" },
    ],
  },
  {
    id: "blouse_length",
    label: "Blouse length",
    group: "critical",
    route: "/design/length",
    defaultOptionId: "regular",
    options: [
      { id: "regular", label: "Regular" },
      { id: "short_choli", label: "Short choli" },
      { id: "long_waist", label: "Long waist-length" },
    ],
  },
  {
    id: "front_neck",
    label: "Front neck cut",
    group: "critical",
    route: "/design/front-neck",
    defaultOptionId: "round",
    options: [
      { id: "round", label: "Round" },
      {
        id: "deep",
        label: "Deep",
        subOptions: [
          { id: "u", label: "U-shape" },
          { id: "v", label: "V-shape" },
          { id: "round", label: "Round" },
          { id: "square", label: "Square" },
        ],
      },
      { id: "sweetheart", label: "Sweetheart" },
      { id: "boat", label: "Boat" },
      {
        id: "high_neck",
        label: "High neck",
        subOptions: [
          { id: "band_collar", label: "Band collar" },
          { id: "full_collar", label: "Full collar" },
          { id: "full_high", label: "Full high neck" },
        ],
      },
    ],
  },
  {
    id: "back_cut",
    label: "Back cut",
    group: "critical",
    route: "/design/back",
    defaultOptionId: "regular",
    options: [
      { id: "regular", label: "Regular" },
      {
        id: "deep",
        label: "Deep",
        subOptions: [
          { id: "u", label: "U-shape" },
          { id: "v", label: "V-shape" },
          { id: "round", label: "Round" },
          { id: "square", label: "Square" },
        ],
      },
      {
        id: "backless",
        label: "Backless",
        subOptions: [
          { id: "strings_straight", label: "Strings straight" },
          { id: "strings_cross", label: "Strings cross" },
          { id: "strap", label: "Strap" },
        ],
      },
    ],
  },
  {
    id: "tying",
    label: "Tying mechanism",
    group: "critical",
    route: "/design/tying",
    // Suggested default pending product confirmation (spec §13): back hook
    defaultOptionId: null,
    options: [
      {
        id: "hook",
        label: "Hook",
        subOptions: [
          { id: "front", label: "Front hook" },
          { id: "back", label: "Back hook" },
        ],
      },
      {
        id: "chain",
        label: "Chain",
        subOptions: [
          { id: "left", label: "Left chain" },
          { id: "right", label: "Right chain" },
          { id: "back", label: "Back chain" },
        ],
      },
      {
        id: "button",
        label: "Button",
        subOptions: [
          { id: "front", label: "Front button" },
          // CSV says "Button Button" — confirm (spec §13). Treating as Back button.
          { id: "back", label: "Back button" },
        ],
      },
    ],
  },
  {
    id: "shoulder",
    label: "Shoulder",
    group: "fit",
    route: "/design/fit",
    // Suggested default pending product confirmation: regular
    defaultOptionId: null,
    options: [
      { id: "regular", label: "Regular" },
      { id: "off_shoulder", label: "Off-shoulder" },
      { id: "one_shoulder", label: "One-shoulder" },
      {
        id: "strappy",
        label: "Strappy",
        subOptions: [
          { id: "broad", label: "Broad" },
          { id: "spaghetti", label: "Thin-round (spaghetti)" },
        ],
      },
      {
        id: "halter",
        label: "Halter",
        subOptions: [
          { id: "broad", label: "Broad" },
          { id: "spaghetti", label: "Thin-round (spaghetti)" },
        ],
      },
      { id: "cold_shoulder", label: "Cold shoulder" },
    ],
  },
  {
    id: "sleeve",
    label: "Sleeve style",
    group: "fit",
    route: "/design/fit",
    // Suggested default pending product confirmation: regular_short
    defaultOptionId: null,
    options: [
      { id: "sleeveless", label: "Sleeveless" },
      { id: "cap", label: "Cap sleeve" },
      { id: "regular_short", label: "Regular short", priceKey: "sleeve_regular_short" },
      { id: "elbow", label: "Elbow length", priceKey: "sleeve_elbow" },
      { id: "three_quarter", label: "Three-quarter", priceKey: "sleeve_three_quarter" },
      { id: "full", label: "Full-sleeve", priceKey: "sleeve_full" },
    ],
  },
  {
    id: "neck_side",
    label: "Neck (keyhole side)",
    group: "fit",
    route: "/design/fit",
    // Suggested default pending product confirmation: back
    defaultOptionId: null,
    options: [
      { id: "back", label: "Back-side" },
      { id: "front", label: "Front-side" },
    ],
  },
];

export const ADD_ONS: AddOn[] = [
  {
    id: "piping",
    label: "Piping",
    kind: "toggle",
    group: "addon_material",
    priceKey: "piping",
  },
  {
    id: "lining",
    label: "Lining / Astar",
    kind: "choice",
    group: "addon_material",
    priceKey: "lining",
    caption: "Depends on your cloth — our Style Captain will confirm at the visit.",
    choices: [
      { id: "full", label: "Full" },
      { id: "half", label: "Half" },
    ],
  },
  {
    id: "button_decor",
    label: "Button decor",
    kind: "toggle",
    group: "addon_material",
    priceKey: "button_decor",
    contextRoutes: ["/design/tying"],
    caption: "Also editable on the tying screen.",
  },
  {
    id: "boning",
    label: "Boning",
    kind: "toggle",
    group: "addon_material",
    priceKey: "boning",
  },
  {
    id: "border",
    label: "Border",
    kind: "choice",
    group: "addon_material",
    priceKey: "border",
    choices: [{ id: "lace", label: "Lace" }],
  },
  {
    id: "latkan",
    label: "Latkan",
    kind: "placements",
    group: "addon_material",
    priceKey: "latkan",
    placements: [
      { id: "front_neck", label: "Front neck" },
      { id: "back_neck", label: "Back neck" },
      { id: "sleeves", label: "Sleeves" },
      { id: "bottom", label: "Bottom" },
    ],
    perPlacementSizes: [
      { id: "s", label: "Small" },
      { id: "m", label: "Medium" },
      { id: "l", label: "Large" },
    ],
  },
  {
    id: "breast_cups",
    label: "Breast cups",
    kind: "toggle",
    group: "addon_material",
    priceKey: "breast_cups",
    extraInput: { id: "cup_size", label: "Cup size", type: "text" },
  },
  {
    id: "moti_work",
    label: "Moti-work",
    kind: "toggle",
    group: "addon_material",
    priceKey: "moti_work",
    caption: "Placements and pricing to be confirmed — our Style Captain will call you.",
  },
  {
    id: "net_work",
    label: "Net work",
    kind: "placements",
    group: "addon_material",
    priceKey: "net_work",
    placements: [
      { id: "front_neck", label: "Front neck" },
      { id: "back_neck", label: "Back neck" },
      { id: "sleeves", label: "Sleeves" },
      { id: "bottom", label: "Bottom" },
    ],
  },
  {
    id: "keyhole_front",
    label: "Key hole — front-side",
    kind: "choice",
    group: "addon_style",
    priceKey: "keyhole",
    choices: [
      { id: "round", label: "Round" },
      { id: "drop", label: "Drop" },
      { id: "triangle", label: "Triangle" },
      { id: "bow", label: "Bow" },
    ],
    contextRoutes: ["/design/front-neck"],
  },
  {
    id: "keyhole_back",
    label: "Key hole — back-side",
    kind: "choice",
    group: "addon_style",
    priceKey: "keyhole",
    choices: [
      { id: "round", label: "Round" },
      { id: "drop", label: "Drop" },
      { id: "triangle", label: "Triangle" },
      { id: "bow", label: "Bow" },
    ],
    contextRoutes: ["/design/back"],
  },
  {
    id: "tassels",
    label: "Tassels",
    kind: "placements",
    group: "addon_style",
    priceKey: "tassels",
    placements: [
      { id: "front_neck", label: "Front neck" },
      { id: "back_neck", label: "Back neck" },
      { id: "sleeves", label: "Sleeves" },
      { id: "bottom", label: "Bottom" },
    ],
    contextRoutes: ["/design/front-neck", "/design/back", "/design/fit", "/design/length"],
  },
];

/* ----- Convenience lookups (derived, never hard-coded in components) ----- */

export const CATEGORY_BY_ID: Record<string, Category> = Object.fromEntries(
  CATALOG.map((c) => [c.id, c]),
);

export const ADDON_BY_ID: Record<string, AddOn> = Object.fromEntries(
  ADD_ONS.map((a) => [a.id, a]),
);

export function findCategory(route: string): Category | undefined {
  return CATALOG.find((c) => c.route === route);
}

export function findCategoryById(id: string): Category | undefined {
  return CATEGORY_BY_ID[id];
}

export function addOnsForRoute(route: string): AddOn[] {
  return ADD_ONS.filter((a) => a.contextRoutes?.includes(route));
}

/**
 * Sleeve options that have no sleeve surface to attach placement-based add-ons to.
 */
const SLEEVELESS_OPTION_IDS = new Set(["sleeveless", "cap"]);

/**
 * Per spec §7 note: the Tassels row exposes only the relevant placement on each
 * contextual screen (length → bottom, back → back_neck, fit → sleeves, front-neck → front_neck).
 *
 * When the current sleeve selection is sleeveless (or cap), the "sleeves" placement
 * is hidden for all placement-based add-ons — there's no sleeve to attach to.
 */
export function visiblePlacementsFor(
  addOnId: string,
  route: string | null,
  sleeveOptionId?: string,
) {
  const addOn = ADDON_BY_ID[addOnId];
  if (!addOn?.placements) return addOn?.placements ?? [];

  // Filter out "sleeves" placement when sleeve style has no sleeves
  const hasNoSleeves = sleeveOptionId
    ? SLEEVELESS_OPTION_IDS.has(sleeveOptionId)
    : false;

  let placements = addOn.placements;
  if (hasNoSleeves) {
    placements = placements.filter((p) => p.id !== "sleeves");
  }

  if (!route) return placements;
  if (addOnId === "tassels") {
    if (route === "/design/length") return placements.filter((p) => p.id === "bottom");
    if (route === "/design/back") return placements.filter((p) => p.id === "back_neck");
    if (route === "/design/fit") return placements.filter((p) => p.id === "sleeves");
    if (route === "/design/front-neck") return placements.filter((p) => p.id === "front_neck");
  }
  return placements;
}
