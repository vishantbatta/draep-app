/**
 * Auto-design ("Share a design with us") — the pure glue between the
 * backend's analysis result, MYOD's `Selections` map and the review sheet's
 * item rows. One shape in the middle (Selections) feeds both the gap-filling
 * MyodSheet and the GarmentSelectionSheet seeds, so every converter here is
 * exercised in both directions.
 */
import { describe, expect, it } from "vitest";

import {
  aiResultToSelections,
  draftItemsToSelections,
  selectionsToSeedItems,
  withImageExtension,
} from "../auto-design";
import { filterStepsById, type DesignStep } from "../myod-steps";
import type { AutoDesignDone } from "../api/autoDesign";
import type { DraftItem } from "@/components/admin/GarmentSelectionSheet";

const done = (over: Partial<AutoDesignDone> = {}): AutoDesignDone => ({
  garment_id: "g-blouse",
  selections: [],
  addons: [],
  missing_critical: [],
  ...over,
});

const sel = (
  component_id: string,
  variation_id: string,
  variation_type_id: string | null = null,
) => ({
  component_id,
  component_label: component_id,
  variation_id,
  variation_label: variation_id,
  variation_type_id,
  variation_type_label: variation_type_id,
});

const addon = (
  addon_id: string,
  addon_variation_id: string | null,
  placement: string[] | null = null,
) => ({
  addon_id,
  addon_label: addon_id,
  addon_variation_id,
  addon_variation_label: addon_variation_id,
  placement,
});

// ─── aiResultToSelections ────────────────────────────────────────────────────

describe("aiResultToSelections", () => {
  it("keys component picks by component id, with the sub-type when present", () => {
    const out = aiResultToSelections(
      done({ selections: [sel("c-cut", "v-princess"), sel("c-front", "v-deep", "t-v")] }),
    );
    expect(out).toEqual({
      "c-cut": { variationId: "v-princess" },
      "c-front": { variationId: "v-deep", variationTypeId: "t-v" },
    });
  });

  it("maps a toggle add-on (no variation) to __toggle_on__, carrying its first placement", () => {
    expect(aiResultToSelections(done({ addons: [addon("a-lining", null)] }))).toEqual({
      "a-lining": { variationId: "__toggle_on__" },
    });
    expect(
      aiResultToSelections(done({ addons: [addon("a-net", null, ["Back neck", "Neckline"])] })),
    ).toEqual({ "a-net": { variationId: "__toggle_on__", placement: "Back neck" } });
  });

  it("keeps a single-placement choice add-on flat", () => {
    expect(
      aiResultToSelections(done({ addons: [addon("a-piping", "av-thin", ["Neckline"])] })),
    ).toEqual({ "a-piping": { variationId: "av-thin", placement: "Neckline" } });
    expect(aiResultToSelections(done({ addons: [addon("a-piping", "av-thin")] }))).toEqual({
      "a-piping": { variationId: "av-thin" },
    });
  });

  it("expands several placements — across rows or inside one row — into per-spot picks", () => {
    const out = aiResultToSelections(
      done({
        addons: [
          addon("a-piping", "av-thin", ["Neckline", "Sleeves"]),
          addon("a-piping", "av-thick", ["Back neck"]),
        ],
      }),
    );
    expect(out).toEqual({
      "a-piping": {
        variationId: "av-thin",
        picks: [
          { variationId: "av-thin", placement: "Neckline" },
          { variationId: "av-thin", placement: "Sleeves" },
          { variationId: "av-thick", placement: "Back neck" },
        ],
      },
    });
  });

  it("ignores rows without usable ids", () => {
    const bad = done({
      selections: [{ ...sel("c-x", "v-1"), component_id: "" }, { ...sel("c-y", ""), variation_id: "" }],
      addons: [{ ...addon("", "av-1"), addon_id: "" }],
    });
    expect(aiResultToSelections(bad)).toEqual({});
  });
});

// ─── selectionsToSeedItems ───────────────────────────────────────────────────

describe("selectionsToSeedItems", () => {
  const addonIds = new Set(["a-piping", "a-lining", "a-off"]);

  it("emits a variation row per component and an add_on row per add-on", () => {
    const rows = selectionsToSeedItems(
      {
        "c-cut": { variationId: "v-princess" },
        "c-front": { variationId: "v-deep", variationTypeId: "t-v" },
        "a-lining": { variationId: "__toggle_on__" },
        "a-piping": { variationId: "av-thin", placement: "Neckline" },
      },
      addonIds,
    );
    expect(rows).toEqual([
      {
        type: "variation",
        garment_style_component_id: "c-cut",
        variation_id: "v-princess",
        variation_type_id: null,
        addon_id: null,
        addon_variation_id: null,
        placement: null,
      },
      {
        type: "variation",
        garment_style_component_id: "c-front",
        variation_id: "v-deep",
        variation_type_id: "t-v",
        addon_id: null,
        addon_variation_id: null,
        placement: null,
      },
      {
        type: "add_on",
        garment_style_component_id: null,
        variation_id: null,
        variation_type_id: null,
        addon_id: "a-lining",
        addon_variation_id: null,
        placement: null,
      },
      {
        type: "add_on",
        garment_style_component_id: null,
        variation_id: null,
        variation_type_id: null,
        addon_id: "a-piping",
        addon_variation_id: "av-thin",
        placement: ["Neckline"],
      },
    ]);
  });

  it("fans multi-spot picks out to one add_on row per spot", () => {
    const rows = selectionsToSeedItems(
      {
        "a-piping": {
          variationId: "av-thin",
          picks: [
            { variationId: "av-thin", placement: "Neckline" },
            { variationId: "av-thick", placement: "Sleeves" },
          ],
        },
      },
      addonIds,
    );
    expect(rows.map((r) => [r.addon_variation_id, r.placement])).toEqual([
      ["av-thin", ["Neckline"]],
      ["av-thick", ["Sleeves"]],
    ]);
  });

  it("skips add-ons explicitly toggled off and component picks of multi-select components fan out too", () => {
    const rows = selectionsToSeedItems(
      {
        "a-off": { variationId: "__off__" },
        "c-multi": {
          variationId: "v-a",
          picks: [{ variationId: "v-a" }, { variationId: "v-b", variationTypeId: "t-1" }],
        },
      },
      addonIds,
    );
    expect(rows).toEqual([
      expect.objectContaining({ type: "variation", garment_style_component_id: "c-multi", variation_id: "v-a", variation_type_id: null }),
      expect.objectContaining({ type: "variation", garment_style_component_id: "c-multi", variation_id: "v-b", variation_type_id: "t-1" }),
    ]);
  });
});

// ─── draftItemsToSelections ──────────────────────────────────────────────────

const row = (over: Partial<DraftItem>): DraftItem => ({
  type: "variation",
  garment_style_component_id: null,
  variation_id: null,
  variation_type_id: null,
  addon_id: null,
  addon_variation_id: null,
  placement: null,
  price: null,
  label_snapshot: null,
  ...over,
});

describe("draftItemsToSelections", () => {
  it("round-trips the review sheet's rows back into MYOD selections", () => {
    const out = draftItemsToSelections([
      row({ type: "variation", garment_style_component_id: "c-cut", variation_id: "v-princess" }),
      row({ type: "variation", garment_style_component_id: "c-front", variation_id: "v-deep", variation_type_id: "t-v" }),
      row({ type: "add_on", addon_id: "a-lining" }),
      row({ type: "add_on", addon_id: "a-piping", addon_variation_id: "av-thin", placement: ["Neckline"] }),
    ]);
    expect(out).toEqual({
      "c-cut": { variationId: "v-princess" },
      "c-front": { variationId: "v-deep", variationTypeId: "t-v" },
      "a-lining": { variationId: "__toggle_on__" },
      "a-piping": {
        variationId: "av-thin",
        picks: [{ variationId: "av-thin", placement: "Neckline" }],
      },
    });
  });

  it("groups several rows of one add-on into picks and keeps a placement-less single row flat", () => {
    const out = draftItemsToSelections([
      row({ type: "add_on", addon_id: "a-piping", addon_variation_id: "av-thin", placement: ["Neckline"] }),
      row({ type: "add_on", addon_id: "a-piping", addon_variation_id: "av-thick", placement: ["Sleeves"] }),
      row({ type: "add_on", addon_id: "a-latkan", addon_variation_id: "av-small" }),
    ]);
    expect(out).toEqual({
      "a-piping": {
        variationId: "av-thin",
        picks: [
          { variationId: "av-thin", placement: "Neckline" },
          { variationId: "av-thick", placement: "Sleeves" },
        ],
      },
      "a-latkan": { variationId: "av-small" },
    });
  });

  it("carries a toggle add-on's placement and skips rows without ids; a later variation row wins", () => {
    const out = draftItemsToSelections([
      row({ type: "add_on", addon_id: "a-net", placement: ["Back neck"] }),
      row({ type: "add_on", addon_id: null, addon_variation_id: "av-x" }),
      row({ type: "variation", garment_style_component_id: null, variation_id: "v-x" }),
      row({ type: "variation", garment_style_component_id: "c-cut", variation_id: "v-a" }),
      row({ type: "variation", garment_style_component_id: "c-cut", variation_id: "v-b" }),
    ]);
    expect(out).toEqual({
      "a-net": { variationId: "__toggle_on__", placement: "Back neck" },
      "c-cut": { variationId: "v-b" },
    });
  });

  it("is the inverse of selectionsToSeedItems for a typical design", () => {
    const original = {
      "c-cut": { variationId: "v-princess" },
      "c-front": { variationId: "v-deep", variationTypeId: "t-v" },
      "a-lining": { variationId: "__toggle_on__" },
      "a-piping": {
        variationId: "av-thin",
        picks: [
          { variationId: "av-thin", placement: "Neckline" },
          { variationId: "av-thin", placement: "Sleeves" },
        ],
      },
    };
    const seeds = selectionsToSeedItems(original, new Set(["a-lining", "a-piping"]));
    const back = draftItemsToSelections(
      seeds.map((s) =>
        row({
          ...s,
          type: s.type ?? "variation",
          placement: Array.isArray(s.placement) ? s.placement : s.placement ? [s.placement] : null,
        }),
      ),
    );
    expect(back).toEqual(original);
  });
});

// ─── filterStepsById ─────────────────────────────────────────────────────────

describe("filterStepsById", () => {
  const steps = [
    { id: "c-cut", title: "Cut", components: [] },
    { id: "c-front", title: "Front", components: [] },
    { id: "extras", title: "Extras", components: [], isExtras: true },
  ] as unknown as DesignStep[];

  it("returns every step when no filter is given", () => {
    expect(filterStepsById(steps, undefined)).toBe(steps);
  });

  it("keeps only the named steps, in catalog order, dropping unknown ids", () => {
    expect(filterStepsById(steps, ["c-front", "c-ghost", "c-cut"]).map((s) => s.id)).toEqual([
      "c-cut",
      "c-front",
    ]);
  });

  it("returns an empty list when nothing matches", () => {
    expect(filterStepsById(steps, ["nope"])).toEqual([]);
  });
});

// ─── withImageExtension ──────────────────────────────────────────────────────

describe("withImageExtension", () => {
  it("keeps names that already carry an accepted extension", () => {
    expect(withImageExtension("IMG_01.JPG", "image/jpeg")).toBe("IMG_01.JPG");
    expect(withImageExtension("a.heic", "image/heic")).toBe("a.heic");
  });

  it("adds the MIME type's extension to bare or foreign names", () => {
    expect(withImageExtension("blob", "image/png")).toBe("blob.png");
    expect(withImageExtension("capture", "image/jpeg")).toBe("capture.jpg");
    expect(withImageExtension("scan.tiff", "image/webp")).toBe("scan.webp");
  });

  it("falls back to .jpg for unknown types and empty names", () => {
    expect(withImageExtension("", "application/octet-stream")).toBe("photo.jpg");
  });
});
