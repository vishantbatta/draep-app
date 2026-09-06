/**
 * Combo requirement groups (group M FE) — the "cart must contain …" rows on
 * the promo form. Pure builders: options payload / scope.requires ↔ draft
 * rows, and the full-catalog tree where every tier is selectable.
 */

import { describe, expect, it } from "vitest";

import type { PromoOptions } from "@/lib/admin-api";
import { selectedLabelMap, type PickerNode } from "@/lib/promo-pickers";
import {
  EMPTY_REQUIRE_GROUP,
  bucketSelection,
  requirementNodes,
  requireGroupSlugs,
  requireGroupsToScope,
  scopeToRequireGroups,
} from "@/lib/promo-requires";

const OPTS: PromoOptions = {
  garments: [
    {
      slug: "blouse",
      label: "Blouse",
      price: 2500,
      children: [
        {
          slug: "sleeve",
          label: "Sleeve style",
          price: null,
          children: [
            {
              slug: "sleeveless",
              label: "Sleeveless",
              price: 0,
              children: [{ slug: "cap", label: "Cap", price: 100, children: [] }],
            },
            { slug: "full", label: "Full", price: 200, children: [] },
          ],
        },
        {
          slug: "neck",
          label: "Front neck",
          price: null,
          children: [
            {
              slug: "collar",
              label: "Collar",
              price: 0,
              children: [{ slug: "vshape", label: "V shape", price: 150, children: [] }],
            },
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
      garment_slug: "blouse",
      garment_label: "Blouse",
      children: [
        { slug: "light", label: "Light", price: 100, children: [] },
        { slug: "heavy", label: "Heavy", price: 250, children: [] },
      ],
    },
    { slug: "piping", label: "Piping", price: 60, children: [] }, // global — no parent garment
  ],
  service_areas: [],
};

function find(nodes: PickerNode[], key: string): PickerNode | undefined {
  const walk = (ns: PickerNode[]): PickerNode | undefined => {
    for (const n of ns) {
      if (n.key === key) return n;
      const hit = n.children ? walk(n.children) : undefined;
      if (hit) return hit;
    }
    return undefined;
  };
  return walk(nodes);
}

describe("requirementNodes", () => {
  it("makes every catalog tier selectable — folders included", () => {
    const nodes = requirementNodes(OPTS, []);
    const blouse = find(nodes, "blouse");
    expect(blouse?.selectable).toBe(true); // garment (a folder!) selectable
    expect(blouse?.children?.length).toBe(3); // …and still drillable (2 components + nested latkan)
    expect(find(nodes, "sleeve")?.selectable).toBe(true); // component
    expect(find(nodes, "sleeveless")?.selectable).toBe(true); // variation
    expect(find(nodes, "vshape")?.selectable).toBe(true); // variation type
    expect(find(nodes, "kurti")?.selectable).toBe(true); // childless garment leaf
    expect(find(nodes, "latkan")?.selectable).toBe(true); // add-on folder
    expect(find(nodes, "light")?.selectable).toBe(true); // add-on variation
    expect(find(nodes, "piping")?.selectable).toBe(true); // flat add-on leaf
  });

  it("nests add-ons under their parent garment; globals stay top-level", () => {
    const nodes = requirementNodes(OPTS, []);
    expect(nodes.map((n) => n.key)).toEqual(["blouse", "kurti", "piping"]);
    const blouse = find(nodes, "blouse");
    const latkan = blouse?.children?.find((c) => c.key === "latkan");
    expect(latkan?.sublabel).toBe("Add-on · 2 variations"); // tier visible next to components
    expect(latkan?.children?.map((c) => c.key)).toEqual(["light", "heavy"]);
    expect(find(nodes, "piping")?.sublabel).toBe("₹60"); // global add-on keeps price sublabel
  });

  it("falls back to top-level when the parent garment slug is unknown", () => {
    const orphan = requirementNodes(
      {
        ...OPTS,
        addons: [OPTS.addons[1], { ...OPTS.addons[0], slug: "tassels", garment_slug: "petticoat" }],
      },
      [],
    );
    expect(orphan.map((n) => n.key)).toEqual(["blouse", "kurti", "piping", "tassels"]);
  });

  it("marks selection on whichever tier holds the key", () => {
    const nodes = requirementNodes(OPTS, ["blouse", "sleeveless", "light"]);
    expect(find(nodes, "blouse")?.selected).toBe(true);
    expect(find(nodes, "sleeveless")?.selected).toBe(true);
    expect(find(nodes, "light")?.selected).toBe(true);
    expect(find(nodes, "full")?.selected).toBe(false);
  });

  it("labels resolve across every tier for the chip box", () => {
    const labels = selectedLabelMap(requirementNodes(OPTS, []));
    expect(labels.get("blouse")).toBe("Blouse");
    expect(labels.get("sleeve")).toBe("Sleeve style");
    expect(labels.get("vshape")).toBe("V shape");
    expect(labels.get("light")).toBe("Light");
  });
});

describe("bucketSelection", () => {
  it("classifies a flat sheet selection into tier buckets", () => {
    const g = bucketSelection(OPTS, ["blouse", "sleeveless", "vshape", "latkan", "light"]);
    expect(g.garmentSlugs).toBe("blouse");
    expect(g.variationSlugs).toBe("sleeveless");
    expect(g.variationTypeSlugs).toBe("vshape");
    expect(g.addonSlugs).toBe("latkan");
    expect(g.addonVariationSlugs).toBe("light");
    expect(g.componentSlugs).toBe("");
  });

  it("keeps unknown slugs in their previous bucket (edit fidelity)", () => {
    const prev = { ...EMPTY_REQUIRE_GROUP, variationSlugs: "ghost-var" };
    const g = bucketSelection(OPTS, ["ghost-var"], prev);
    expect(g.variationSlugs).toBe("ghost-var");
    expect(g.garmentSlugs).toBe("");
  });

  it("lands brand-new unknown slugs in the garment bucket", () => {
    const g = bucketSelection(OPTS, ["ghost"], undefined);
    expect(g.garmentSlugs).toBe("ghost");
  });

  it("carries the previous min qty through", () => {
    const prev = { ...EMPTY_REQUIRE_GROUP, minQty: "2" };
    expect(bucketSelection(OPTS, ["blouse"], prev).minQty).toBe("2");
    expect(bucketSelection(OPTS, ["blouse"]).minQty).toBe("1");
  });
});

describe("requireGroupsToScope", () => {
  it("emits snake keys with parsed min_qty", () => {
    const scope = requireGroupsToScope([
      {
        ...EMPTY_REQUIRE_GROUP,
        componentSlugs: "sleeve",
        variationSlugs: "sleeveless",
        minQty: "1",
      },
      { ...EMPTY_REQUIRE_GROUP, variationTypeSlugs: "vshape", minQty: "3" },
    ]);
    expect(scope).toEqual([
      { component_slugs: ["sleeve"], variation_slugs: ["sleeveless"], min_qty: 1 },
      { variation_type_slugs: ["vshape"], min_qty: 3 },
    ]);
  });

  it("drops groups without a single slug (untouched rows never block)", () => {
    expect(requireGroupsToScope([EMPTY_REQUIRE_GROUP])).toEqual([]);
    expect(requireGroupsToScope([{ ...EMPTY_REQUIRE_GROUP, minQty: "2" }])).toEqual([]);
  });

  it("clamps unparsable min_qty to 1", () => {
    const [g] = requireGroupsToScope([{ ...EMPTY_REQUIRE_GROUP, garmentSlugs: "blouse", minQty: "" }]);
    expect(g.min_qty).toBe(1);
  });
});

describe("scopeToRequireGroups", () => {
  it("round-trips scope.requires into CSV drafts", () => {
    const groups = scopeToRequireGroups({
      requires: [
        { component_slugs: ["sleeve"], variation_slugs: ["sleeveless"], min_qty: 1 },
        { garment_slugs: ["blouse", "petticoat"], min_qty: 2 },
      ],
    });
    expect(groups).toEqual([
      expect.objectContaining({
        componentSlugs: "sleeve",
        variationSlugs: "sleeveless",
        minQty: "1",
      }),
      expect.objectContaining({ garmentSlugs: "blouse, petticoat", minQty: "2" }),
    ]);
  });

  it("empty / missing requires → no rows", () => {
    expect(scopeToRequireGroups({})).toEqual([]);
    expect(scopeToRequireGroups({ requires: null })).toEqual([]);
  });
});

describe("requireGroupSlugs", () => {
  it("unions every bucket in tier order", () => {
    const keys = requireGroupSlugs({
      ...EMPTY_REQUIRE_GROUP,
      garmentSlugs: "blouse",
      variationSlugs: "sleeveless, full",
      addonSlugs: "latkan",
    });
    expect(keys).toEqual(["blouse", "sleeveless", "full", "latkan"]);
  });
});
