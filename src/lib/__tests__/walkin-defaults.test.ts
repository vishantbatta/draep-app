/**
 * Walk-in configurator default seeding — show catalog defaults the way
 * /create shows a chosen option: pre-selected.
 *
 * criticalDefaults() resolves every non-extras (choice-step) component to
 * its catalog default variation (+ default sub-type), so the default card
 * renders with the standard selected UI (orange dot, accent border) from
 * the first render — the same indication /create uses, no custom badge.
 * Merged with MYOD's extrasDefaults, which already seeds default-on
 * add-ons / default fit rows the same way /create does.
 */
import { describe, expect, it } from "vitest";

import { criticalDefaults } from "../walkin-defaults";
import type { DesignStep } from "../../lib/myod-steps";

function choiceStep(id: string, compId: string, opts: string[], def?: string): DesignStep {
  return {
    id,
    title: id,
    components: [
      {
        id: compId,
        label: compId,
        kind: "choice",
        defaultOptionId: def,
        options: opts.map((o, i) => ({
          id: o,
          label: o,
          ...(i === 0 ? { subOptions: [{ id: `${o}-type-a` }, { id: `${o}-type-b` }] } : {}),
        })),
      },
    ],
  } as unknown as DesignStep;
}

describe("criticalDefaults", () => {
  it("resolves each choice component to its catalog default variation", () => {
    const steps = [choiceStep("s1", "comp-1", ["v1", "v2"], "v2")];
    expect(criticalDefaults(steps)).toEqual({
      "comp-1": { variationId: "v2" },
    });
  });

  it("carries the default variation's default sub-type when it has one", () => {
    const steps = [choiceStep("s1", "comp-1", ["v1", "v2"], "v1")];
    // choiceStep gives v1 sub-options without defaultSubOptionId; set one:
    (steps[0].components[0].options[0] as { defaultSubOptionId?: string }).defaultSubOptionId =
      "v1-type-b";
    expect(criticalDefaults(steps)).toEqual({
      "comp-1": { variationId: "v1", variationTypeId: "v1-type-b" },
    });
  });

  it("skips components without a default and extras-step components entirely", () => {
    const steps: DesignStep[] = [
      choiceStep("s1", "comp-1", ["v1"]), // no defaultOptionId
      {
        id: "extras",
        title: "Fit, details & add-ons",
        isExtras: true,
        components: [choiceStep("x", "comp-2", ["v1"], "v1").components[0]],
      } as unknown as DesignStep,
    ];
    expect(criticalDefaults(steps)).toEqual({});
  });

  it("returns {} with no steps", () => {
    expect(criticalDefaults([])).toEqual({});
  });
});
