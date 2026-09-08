import { describe, expect, it } from "vitest";

import { materialBadge, toMaterialChecked } from "./material-flag";

// The DB column is tri-state (true / false / null) but the admin checkbox is
// binary — these tests pin down how the two worlds meet.

describe("toMaterialChecked — raw DB value → checkbox state", () => {
  it.each([
    ["true stays checked", true, true],
    ["false stays unchecked", false, false],
    ["null (flag never set) is unchecked", null, false],
    ["missing key is unchecked", undefined, false],
    ['string "true" is not a boolean', "true", false],
    ["number 1 is not a boolean", 1, false],
    ["0 is not a boolean", 0, false],
  ] as const)("%s", (_name, raw, expected) => {
    expect(toMaterialChecked(raw)).toBe(expected);
  });
});

describe("materialBadge — card pill", () => {
  it("only a strictly-true flag earns the pill", () => {
    expect(materialBadge(true)).toEqual({ label: "Material", variant: "accent" });
  });

  it.each([
    ["false", false],
    ["null", null],
    ["undefined", undefined],
    ["truthy string", "yes"],
    ["truthy number", 1],
  ] as const)("no pill for %s", (_name, raw) => {
    expect(materialBadge(raw)).toBeNull();
  });
});
