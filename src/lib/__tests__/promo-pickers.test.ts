/**
 * Picker-tree builders for the promo form's bottom sheets (Group L FE).
 *
 * Pure functions: PromoOptions (the admin /promotions/options payload) +
 * the currently selected keys → a generic PickerNode tree the sheet
 * renders. All the cascade smarts live here so they're testable without
 * React.
 */

import { describe, expect, it } from "vitest";

import type { PromoOptions } from "@/lib/admin-api";
import { formatPrice } from "@/lib/pricing";
import {
  addonNodes,
  addonVariationNodes,
  areaNodes,
  componentNodes,
  filterPickerNodes,
  garmentNodes,
  selectedLabelMap,
  variationNodes,
  variationTypeNodes,
} from "@/lib/promo-pickers";

const OPTS: PromoOptions = {
  garments: [
    {
      slug: "blouse",
      label: "Blouse",
      price: 2500,
      children: [
        {
          slug: "neck",
          label: "Neck",
          price: null,
          children: [
            {
              slug: "sweetheart",
              label: "Sweetheart",
              price: 0,
              children: [{ slug: "deep", label: "Deep", price: 300, children: [] }],
            },
            { slug: "boat", label: "Boat", price: 200, children: [] },
          ],
        },
      ],
    },
    { slug: "kurti", label: "Kurti", price: 3000, children: [] },
  ],
  addons: [
    {
      slug: "latkan",
      label: "Latkan",
      price: null,
      children: [
        { slug: "light", label: "Light", price: 100, children: [] },
        { slug: "heavy", label: "Heavy", price: 250, children: [] },
      ],
    },
    { slug: "piping", label: "Piping", price: 60, children: [] },
  ],
  service_areas: [
    { id: "hsr", label: "HSR", city: "Bengaluru", pincodes: ["560102", "560103"] },
    { id: "old-blr", label: "Old Blr", city: "Bengaluru", pincodes: [] },
  ],
};

function find(nodes: ReturnType<typeof garmentNodes>, key: string) {
  const walk = (ns: typeof nodes): typeof nodes[number] | undefined => {
    for (const n of ns) {
      if (n.key === key) return n;
      const hit = n.children ? walk(n.children) : undefined;
      if (hit) return hit;
    }
    return undefined;
  };
  return walk(nodes);
}

describe("garmentNodes — flat multi-select of garments", () => {
  it("lists every garment as a selectable leaf with its price", () => {
    const nodes = garmentNodes(OPTS, ["blouse"]);
    expect(nodes.map((n) => n.key)).toEqual(["blouse", "kurti"]);
    expect(nodes.every((n) => n.selectable)).toBe(true);
    expect(find(nodes, "blouse")?.selected).toBe(true);
    expect(find(nodes, "kurti")?.selected).toBe(false);
    expect(find(nodes, "blouse")?.sublabel).toBe(formatPrice(2500));
  });
});

describe("componentNodes — garment folders → component leaves", () => {
  it("nests components under their garment, folders not selectable", () => {
    const nodes = componentNodes(OPTS, ["neck"]);
    const blouse = find(nodes, "blouse");
    expect(blouse?.selectable).toBe(false);
    expect(blouse?.children?.map((c) => c.key)).toEqual(["neck"]);
    expect(blouse?.children?.[0].selected).toBe(true);
    expect(blouse?.children?.[0].selectable).toBe(true);
    expect(blouse?.children?.[0].sublabel).toBe("in Blouse");
  });

  it("garments without components are dropped", () => {
    const nodes = componentNodes(OPTS, []);
    expect(nodes.map((n) => n.key)).toEqual(["blouse"]);
  });
});

describe("variationNodes — scoped to the chosen components", () => {
  it("component folders carry only their variations", () => {
    const nodes = variationNodes(OPTS, ["boat"], ["neck"]);
    expect(nodes.map((n) => n.key)).toEqual(["neck"]);
    const neck = nodes[0];
    expect(neck.selectable).toBe(false);
    expect(neck.children?.map((v) => v.key)).toEqual(["sweetheart", "boat"]);
    expect(find(nodes, "boat")?.selected).toBe(true);
    expect(find(nodes, "boat")?.sublabel).toBe(formatPrice(200));
  });

  it("empty component filter falls back to every component", () => {
    const nodes = variationNodes(OPTS, [], []);
    expect(nodes.map((n) => n.key)).toEqual(["neck"]);
  });
});

describe("variationTypeNodes — component → variation → type", () => {
  it("three tiers, types are the selectable leaves", () => {
    const nodes = variationTypeNodes(OPTS, ["deep"], ["neck"]);
    const neck = nodes[0];
    expect(neck.key).toBe("neck");
    const sweetheart = neck.children?.[0];
    expect(sweetheart?.key).toBe("sweetheart");
    expect(sweetheart?.selectable).toBe(false);
    const deep = sweetheart?.children?.[0];
    expect(deep?.key).toBe("deep");
    expect(deep?.selected).toBe(true);
    expect(deep?.selectable).toBe(true);
    expect(deep?.sublabel).toBe(formatPrice(300));
  });

  it("variations without types are omitted", () => {
    const nodes = variationTypeNodes(OPTS, [], ["neck"]);
    expect(nodes[0].children?.map((v) => v.key)).toEqual(["sweetheart"]);
  });
});

describe("addonNodes — flat leaves, variation count as sublabel", () => {
  it("matrix add-ons show their variation count, flat ones their price", () => {
    const nodes = addonNodes(OPTS, ["latkan"]);
    expect(find(nodes, "latkan")?.sublabel).toBe("2 variations");
    expect(find(nodes, "latkan")?.selected).toBe(true);
    expect(find(nodes, "piping")?.sublabel).toBe(formatPrice(60));
  });
});

describe("addonVariationNodes — scoped to the chosen add-ons", () => {
  it("only chosen add-on folders appear with their variations", () => {
    const nodes = addonVariationNodes(OPTS, ["heavy"], ["latkan"]);
    expect(nodes.map((n) => n.key)).toEqual(["latkan"]);
    expect(nodes[0].selectable).toBe(false);
    expect(nodes[0].children?.map((v) => v.key)).toEqual(["light", "heavy"]);
    expect(find(nodes, "heavy")?.selected).toBe(true);
  });

  it("empty filter falls back to every add-on with variations", () => {
    const nodes = addonVariationNodes(OPTS, [], []);
    expect(nodes.map((n) => n.key)).toEqual(["latkan"]); // piping has none
  });
});

describe("areaNodes — keyed by id with city + pincode preview", () => {
  it("leaves keyed by area id, not slug", () => {
    const nodes = areaNodes(OPTS, ["hsr"]);
    expect(nodes.map((n) => n.key)).toEqual(["hsr", "old-blr"]);
    expect(find(nodes, "hsr")?.selected).toBe(true);
    expect(find(nodes, "hsr")?.sublabel).toBe("Bengaluru · 560102, 560103");
    expect(find(nodes, "old-blr")?.sublabel).toBe("Bengaluru");
  });
});

describe("filterPickerNodes — search across the whole tree", () => {
  it("a leaf match keeps its ancestor folders", () => {
    const nodes = filterPickerNodes(componentNodes(OPTS, []), "neck");
    expect(nodes.map((n) => n.key)).toEqual(["blouse"]);
    expect(nodes[0].children?.map((c) => c.key)).toEqual(["neck"]);
  });

  it("a folder self-match keeps ALL its descendants", () => {
    const nodes = filterPickerNodes(variationTypeNodes(OPTS, [], ["neck"]), "sweetheart");
    const neck = nodes[0]; // ancestor kept via descendant match
    expect(neck.key).toBe("neck");
    const sweetheart = neck.children?.[0]; // self-matched folder
    expect(sweetheart?.key).toBe("sweetheart");
    expect(sweetheart?.children?.map((t) => t.key)).toEqual(["deep"]); // subtree intact
  });

  it("matches slugs and sublabels too", () => {
    expect(filterPickerNodes(garmentNodes(OPTS, []), "KURT").map((n) => n.key)).toEqual(["kurti"]);
    const addons = filterPickerNodes(addonNodes(OPTS, []), "latk");
    expect(addons.map((n) => n.key)).toEqual(["latkan"]);
  });

  it("a leaf match prunes non-matching siblings and folders", () => {
    const nodes = filterPickerNodes(variationNodes(OPTS, [], ["neck"]), "boat");
    expect(nodes.length).toBeGreaterThan(0); // neck folder survives
    expect(nodes[0].children?.map((v) => v.key)).toEqual(["boat"]);
  });

  it("no match → empty list", () => {
    expect(filterPickerNodes(garmentNodes(OPTS, []), "sherwani")).toEqual([]);
  });
});

describe("selectedLabelMap — resolve keys back to labels", () => {
  it("maps every node's key to its label, folders included", () => {
    const map = selectedLabelMap(componentNodes(OPTS, []));
    expect(map.get("blouse")).toBe("Blouse");
    expect(map.get("neck")).toBe("Neck");
  });

  it("unknown keys (stale scope values) are simply absent", () => {
    const map = selectedLabelMap(garmentNodes(OPTS, ["ghost"]));
    expect(map.has("ghost")).toBe(false);
  });
});
