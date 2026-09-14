/**
 * Walk-in "Choose from library" — library design items → walk-in add payload.
 *
 * The library preview sheet edits a design as AppendDesiredItem rows (the
 * customer append shape). The walk-in wizard adds garments through its own
 * endpoint, whose body takes MYOD-style selections (component/addon id →
 * pick). This mapper bridges the two shapes so a library design lands in the
 * walk-in order through the SAME one-call add-with-selections path the
 * configurator uses — no new backend surface, no default rows materialized.
 */
import { describe, expect, it } from "vitest";

import { libraryItemsToSelections } from "../walkin-library";
import type { AppendDesiredItem } from "../../types/api";

describe("libraryItemsToSelections", () => {
  it("maps variation items to component-keyed selections", () => {
    const items: AppendDesiredItem[] = [
      {
        type: "variation",
        garment_style_component_id: "comp-1",
        variation_id: "var-1",
        variation_type_id: "vt-1",
      },
      {
        type: "variation",
        garment_style_component_id: "comp-2",
        variation_id: "var-2",
      },
    ];
    expect(libraryItemsToSelections(items)).toEqual({
      "comp-1": { variation_id: "var-1", variation_type_id: "vt-1" },
      "comp-2": { variation_id: "var-2" },
    });
  });

  it("groups multiple add-on rows of the same add-on into picks (per placement)", () => {
    const items: AppendDesiredItem[] = [
      {
        type: "add_on",
        addon_id: "addon-1",
        addon_variation_id: "av-1",
        placement: ["front"],
      },
      {
        type: "add_on",
        addon_id: "addon-1",
        addon_variation_id: "av-2",
        placement: ["back"],
      },
    ];
    expect(libraryItemsToSelections(items)).toEqual({
      "addon-1": {
        variation_id: "av-1",
        picks: [
          { variation_id: "av-1", placement: "front" },
          { variation_id: "av-2", placement: "back" },
        ],
      },
    });
  });

  it("maps a single add-on row without picks (placement carried when present)", () => {
    const items: AppendDesiredItem[] = [
      { type: "add_on", addon_id: "addon-2", addon_variation_id: "av-3" },
    ];
    expect(libraryItemsToSelections(items)).toEqual({
      "addon-2": { variation_id: "av-3" },
    });
  });

  it("keeps a variation_type_id alongside picks (first row's type wins)", () => {
    const items: AppendDesiredItem[] = [
      {
        type: "add_on",
        addon_id: "addon-1",
        addon_variation_id: "av-1",
        variation_type_id: "vt-9",
        placement: ["front"],
      },
    ];
    expect(libraryItemsToSelections(items)).toEqual({
      "addon-1": {
        variation_id: "av-1",
        variation_type_id: "vt-9",
        picks: [{ variation_id: "av-1", variation_type_id: "vt-9", placement: "front" }],
      },
    });
  });

  it("skips rows without usable ids (never fatal — mirrors the BE tolerance)", () => {
    const items: AppendDesiredItem[] = [
      { type: "variation", garment_style_component_id: "comp-x" }, // no variation
      { type: "add_on", addon_id: "addon-y" }, // no variation
      { type: "variation", variation_id: "orphan-var" }, // no component key
    ];
    expect(libraryItemsToSelections(items)).toEqual({});
  });

  it("later variation rows for the same component win (editor reconciles to one)", () => {
    const items: AppendDesiredItem[] = [
      { type: "variation", garment_style_component_id: "c", variation_id: "v-old" },
      { type: "variation", garment_style_component_id: "c", variation_id: "v-new" },
    ];
    expect(libraryItemsToSelections(items)).toEqual({
      c: { variation_id: "v-new" },
    });
  });

  it("returns {} for an empty design", () => {
    expect(libraryItemsToSelections([])).toEqual({});
  });
});
