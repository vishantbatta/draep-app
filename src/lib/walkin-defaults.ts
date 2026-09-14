/**
 * Walk-in configurator default seeding — show catalog defaults the way
 * /create shows a chosen option: pre-selected (the standard selected-card
 * UI), never a custom badge.
 */

import type { DesignStep, Selections } from "./myod-steps";

/**
 * Every non-extras (choice-step) component resolved to its catalog default
 * variation, plus the default variation's default sub-type when it has one.
 * Components without a default are skipped — nothing is invented.
 */
export function criticalDefaults(steps: DesignStep[]): Selections {
  const out: Selections = {};
  for (const step of steps) {
    if (step.isExtras) continue;
    for (const c of step.components) {
      const def = c.defaultOptionId;
      if (!def) continue;
      const opt = c.options.find((o) => o.id === def);
      out[c.id] = {
        variationId: def,
        ...(opt?.defaultSubOptionId
          ? { variationTypeId: opt.defaultSubOptionId }
          : {}),
      };
    }
  }
  return out;
}
